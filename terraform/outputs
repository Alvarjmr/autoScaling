output "alb_url" {
  description = "URL HTTP pública del Application Load Balancer"
  value       = "http://${aws_lb.web.dns_name}"
}

output "alb_dns_name" {
  description = "DNS del Application Load Balancer"
  value       = aws_lb.web.dns_name
}

output "autoscaling_group_name" {
  description = "Nombre del Auto Scaling Group"
  value       = aws_autoscaling_group.web.name
}

output "target_group_arn" {
  description = "ARN del Target Group del ALB"
  value       = aws_lb_target_group.web.arn
}

output "cpu_high_alarm_name" {
  description = "Nombre de la alarma CloudWatch de Scale-Out"
  value       = aws_cloudwatch_metric_alarm.cpu_high.alarm_name
}

output "cpu_low_alarm_name" {
  description = "Nombre de la alarma CloudWatch de Scale-In"
  value       = aws_cloudwatch_metric_alarm.cpu_low.alarm_name
}

output "vpc_id" {
  description = "ID de la VPC creada"
  value       = aws_vpc.main.id
}
