# AWS Auto Scaling Group (1 ↔ 4) + ALB + Nginx Visual Stress & Load Balancing Lab

Proyecto desplegado mediante **Terraform** y **GitHub Actions (OIDC)** sin bootstrap propio: reutiliza el proveedor OIDC, rol IAM y backend remoto (S3 + DynamoDB) configurados en el proyecto hermano [`agentes`](../agentes).

## Arquitectura (100% AWS Free Tier)

- **Cómputo**: Auto Scaling Group con instancias **`t3.micro`** (Amazon Linux 2023), límite inferior **`min_size = 1`** y límite superior **`max_size = 4`**.
- **Red y Balanceo**: VPC dedicada con 2 subredes públicas en distintas Zonas de Disponibilidad (sin NAT Gateway para evitar costos), **Application Load Balancer (ALB)** y Target Group sin *stickiness* (`enabled = false`) con *health check* en `/health`.
- **Seguridad**: Security Group de EC2 restringido únicamente al tráfico HTTP del ALB (sin SSH expuesto), IMDSv2 obligatorio y acceso opcional por AWS SSM.
- **Alarmas CloudWatch (Basic Monitoring 5m)**:
  - **Scale-Out (`autoscaling-web-cpu-high`)**: `CPUUtilization >= 50%` (+1 instancia) y `>= 75%` (+3 instancias hasta el máximo de **4**).
  - **Scale-In (`autoscaling-web-cpu-low`)**: `CPUUtilization <= 20%` durante 2 períodos consecutivos de 5 min (-1 / -2 instancias hasta volver al mínimo de **1**).
- **Dashboard Visual en Nginx**:
  - Botón **🔥 Iniciar Prueba de Estrés**: satura los 2 vCPUs de las instancias `t3.micro` y envía pulsos continuos vía ALB para escalar hasta **4** instancias.
  - Botón **⚡ Ejecutar Prueba de Balanceo**: envía ráfagas HTTP sin caché al ALB y grafica en vivo qué instancia (`Instance ID`, `AZ`, `IP`, `% CPU`) atendió cada petición.

## Despliegue por Pipeline (GitHub Actions)

1. El bootstrap de `agentes` debe estar aplicado en la cuenta AWS (habilitado para `repo:Alvarjmr/*:*`).
2. En el repositorio `Alvarjmr/autoScaling` en GitHub (**Settings → Secrets and variables → Actions**), configurar:
   - Secret `AWS_ROLE_TO_ASSUME`: ARN del rol OIDC generado por `agentes/bootstrap`.
   - (Opcional) Variable `AWS_REGION`: `us-east-1`.
3. Hacer `git push` a la rama `main` para ejecutar [`.github/workflows/deploy.yml`](.github/workflows/deploy.yml).
