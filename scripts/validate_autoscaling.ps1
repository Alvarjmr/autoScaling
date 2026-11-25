<#
.SYNOPSIS
Valida de extremo a extremo el Auto Scaling Group (1 -> 4 -> 1), las alarmas CloudWatch
y el balanceo de carga en Nginx/ALB.
#>
param(
    [string]$AlbUrl = "",
    [string]$AsgName = "autoscaling-web-asg",
    [string]$HighAlarm = "autoscaling-web-cpu-high",
    [string]$LowAlarm = "autoscaling-web-cpu-low",
    [string]$Region = "us-east-1",
    [int]$MaxWaitMinutes = 25
)

$ErrorActionPreference = "Stop"

if (-not $AlbUrl) {
    $dns = aws elbv2 describe-load-balancers --names "autoscaling-web-alb" --region $Region --query "LoadBalancers[0].DNSName" --output text
    if (-not $dns -or $dns -eq "None") {
        throw "No se encontró el ALB autoscaling-web-alb. Pasa -AlbUrl manualmente."
    }
    $AlbUrl = "http://$dns"
}

Write-Host "==========================================================" -ForegroundColor Cyan
Write-Host "  VALIDACIÓN DE AUTO SCALING, ALARMAS Y BALANCEO DE CARGA" -ForegroundColor Cyan
Write-Host "  ALB URL: $AlbUrl" -ForegroundColor Gray
Write-Host "==========================================================" -ForegroundColor Cyan

function Get-AsgSnapshot {
    $json = aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names $AsgName --region $Region --output json | ConvertFrom-Json
    $asg = $json.AutoScalingGroups[0]
    $alarms = aws cloudwatch describe-alarms --alarm-names $HighAlarm $LowAlarm --region $Region --output json | ConvertFrom-Json
    $alarmMap = @{}
    foreach ($a in $alarms.MetricAlarms) {
        $alarmMap[$a.AlarmName] = $a.StateValue
    }
    $inService = @($asg.Instances | Where-Object { $_.LifecycleState -eq "InService" }).Count
    return [PSCustomObject]@{
        Desired    = $asg.DesiredCapacity
        Total      = $asg.Instances.Count
        InService  = $inService
        HighAlarm  = $alarmMap[$HighAlarm]
        LowAlarm   = $alarmMap[$LowAlarm]
    }
}

function Test-LoadBalancing($requests = 24) {
    $counts = @{}
    for ($i = 1; $i -le $requests; $i++) {
        try {
            $resp = Invoke-RestMethod -Uri "$AlbUrl/api/info?_=$(Get-Random)" -Method Get -TimeoutSec 5
            $id = "$($resp.instanceId) ($($resp.availabilityZone))"
            if (-not $counts.ContainsKey($id)) { $counts[$id] = 0 }
            $counts[$id] += 1
        } catch {
            Write-Warning "Petición $i falló: $_"
        }
    }
    Write-Host "Distribución de $requests peticiones HTTP en el ALB:" -ForegroundColor Yellow
    foreach ($k in $counts.Keys) {
        $pct = [math]::Round(($counts[$k] / $requests) * 100, 1)
        Write-Host "  - $k : $($counts[$k]) peticiones ($pct%)" -ForegroundColor Green
    }
    return $counts.Count
}

Write-Host "`n[1/5] Estado inicial del ASG y prueba inicial de balanceo..." -ForegroundColor Yellow
$snap = Get-AsgSnapshot
$snap | Format-Table -AutoSize
Test-LoadBalancing 10 | Out-Null

Write-Host "`n[2/5] Disparando prueba de estrés vía ALB para activar alarma '$HighAlarm'..." -ForegroundColor Yellow
$stressBody = '{"duration": 480, "workers": 0}'
1..4 | ForEach-Object {
    Invoke-RestMethod -Uri "$AlbUrl/api/stress" -Method Post -ContentType "application/json" -Body $stressBody | Out-Null
}
Write-Host "Estrés iniciado. Monitoreando alarma Scale-Out y subida a 4 instancias..." -ForegroundColor Gray

$deadline = (Get-Date).AddMinutes($MaxWaitMinutes)
$scaledUp = $false
while ((Get-Date) -lt $deadline) {
    # Mantener pulsos de estrés para cualquier nueva instancia que entre al Target Group
    1..4 | ForEach-Object {
        try { Invoke-RestMethod -Uri "$AlbUrl/api/stress" -Method Post -ContentType "application/json" -Body '{"duration": 180, "workers": 0}' -TimeoutSec 4 | Out-Null } catch {}
    }
    $snap = Get-AsgSnapshot
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts] Desired=$($snap.Desired) InService=$($snap.InService)/$($snap.Total) | HighAlarm=$($snap.HighAlarm) | LowAlarm=$($snap.LowAlarm)"
    if ($snap.InService -ge 4 -and $snap.Desired -eq 4) {
        $scaledUp = $true
        break
    }
    Start-Sleep -Seconds 30
}

if (-not $scaledUp) {
    throw "No se alcanzó el límite superior de 4 instancias InService dentro de $MaxWaitMinutes minutos."
}

Write-Host "`n[3/5] Validando balanceo de carga entre las 4 instancias activas..." -ForegroundColor Yellow
$distinct = Test-LoadBalancing 40
Write-Host "Instancias distintas que respondieron en la ráfaga: $distinct / 4" -ForegroundColor Cyan

Write-Host "`n[4/5] Deteniendo estrés en todas las instancias para validar Scale-In..." -ForegroundColor Yellow
1..16 | ForEach-Object {
    try { Invoke-RestMethod -Uri "$AlbUrl/api/stress/stop" -Method Post -TimeoutSec 4 | Out-Null } catch {}
}

$deadlineDown = (Get-Date).AddMinutes($MaxWaitMinutes)
$scaledDown = $false
while ((Get-Date) -lt $deadlineDown) {
    $snap = Get-AsgSnapshot
    $ts = (Get-Date).ToString("HH:mm:ss")
    Write-Host "[$ts] Desired=$($snap.Desired) InService=$($snap.InService)/$($snap.Total) | HighAlarm=$($snap.HighAlarm) | LowAlarm=$($snap.LowAlarm)"
    if ($snap.Desired -eq 1 -and $snap.InService -eq 1 -and $snap.Total -eq 1) {
        $scaledDown = $true
        break
    }
    Start-Sleep -Seconds 30
}

if (-not $scaledDown) {
    Write-Warning "El Scale-In aún está en progreso o esperando el 2do período de 5 min. Último estado: Desired=$($snap.Desired), InService=$($snap.InService)"
} else {
    Write-Host "`n[5/5] ¡VALIDACIÓN COMPLETA! Scale-Out (1 -> 4) y Scale-In (4 -> 1) comprobados con éxito." -ForegroundColor Green
}

Write-Host "`nÚltimas actividades de Auto Scaling:" -ForegroundColor Cyan
aws autoscaling describe-scaling-activities --auto-scaling-group-name $AsgName --region $Region --max-items 10 --query "Activities[].{Time:StartTime,Status:StatusCode,Description:Description}" --output table
