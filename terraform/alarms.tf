# ==============================================================================
# Política y Alarma de Scale-Out (Subir hasta max_size = 4)
# ==============================================================================
resource "aws_autoscaling_policy" "scale_out" {
  name                      = "${var.project_name}-scale-out"
  autoscaling_group_name    = aws_autoscaling_group.web.name
  policy_type               = "StepScaling"
  adjustment_type           = "ChangeInCapacity"
  estimated_instance_warmup = 60

  # 50% <= CPU < 75% -> +1 instancia
  step_adjustment {
    metric_interval_lower_bound = 0
    metric_interval_upper_bound = 25
    scaling_adjustment          = 1
  }

  # CPU >= 75% -> +3 instancias (escala hasta el límite superior de 4)
  step_adjustment {
    metric_interval_lower_bound = 25
    scaling_adjustment          = 3
  }
}

resource "aws_cloudwatch_metric_alarm" "cpu_high" {
  alarm_name          = "${var.project_name}-cpu-high"
  alarm_description   = "Dispara Scale-Out del ASG cuando CPU >= ${var.scale_out_cpu_threshold}%"
  comparison_operator = "GreaterThanOrEqualToThreshold"
  evaluation_periods  = 1
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = var.alarm_period_seconds
  statistic           = "Average"
  threshold           = var.scale_out_cpu_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.web.name
  }

  alarm_actions = [aws_autoscaling_policy.scale_out.arn]
}

# ==============================================================================
# Política y Alarma de Scale-In (Bajar hasta min_size = 1)
# ==============================================================================
resource "aws_autoscaling_policy" "scale_in" {
  name                   = "${var.project_name}-scale-in"
  autoscaling_group_name = aws_autoscaling_group.web.name
  policy_type            = "StepScaling"
  adjustment_type        = "ChangeInCapacity"

  # 10% < CPU <= 20% -> -1 instancia
  step_adjustment {
    metric_interval_lower_bound = -10
    metric_interval_upper_bound = 0
    scaling_adjustment          = -1
  }

  # CPU <= 10% -> -2 instancias (baja progresivamente hasta min_size = 1)
  step_adjustment {
    metric_interval_upper_bound = -10
    scaling_adjustment          = -2
  }
}

resource "aws_cloudwatch_metric_alarm" "cpu_low" {
  alarm_name          = "${var.project_name}-cpu-low"
  alarm_description   = "Dispara Scale-In del ASG cuando CPU <= ${var.scale_in_cpu_threshold}% durante 2 periodos"
  comparison_operator = "LessThanOrEqualToThreshold"
  evaluation_periods  = 2
  metric_name         = "CPUUtilization"
  namespace           = "AWS/EC2"
  period              = var.alarm_period_seconds
  statistic           = "Average"
  threshold           = var.scale_in_cpu_threshold
  treat_missing_data  = "notBreaching"

  dimensions = {
    AutoScalingGroupName = aws_autoscaling_group.web.name
  }

  alarm_actions = [aws_autoscaling_policy.scale_in.arn]
}
