variable "aws_region" {
  description = "Región de AWS donde se desplegará el proyecto."
  type        = string
  default     = "us-east-1"
}

variable "project_name" {
  description = "Prefijo para los recursos del proyecto."
  type        = string
  default     = "autoscaling-web"
}

variable "environment" {
  description = "Entorno de despliegue."
  type        = string
  default     = "prod"
}

variable "instance_type" {
  description = "Tipo de instancia EC2 (t3.micro para Capa Gratuita)."
  type        = string
  default     = "t3.micro"
}

variable "min_size" {
  description = "Límite inferior de instancias del Auto Scaling Group."
  type        = number
  default     = 1
}

variable "max_size" {
  description = "Límite superior de instancias del Auto Scaling Group."
  type        = number
  default     = 4
}

variable "desired_capacity" {
  description = "Capacidad inicial deseada del Auto Scaling Group."
  type        = number
  default     = 1
}

variable "scale_out_cpu_threshold" {
  description = "Porcentaje de CPU promedio para disparar la alarma de Scale-Out."
  type        = number
  default     = 50
}

variable "scale_in_cpu_threshold" {
  description = "Porcentaje de CPU promedio para disparar la alarma de Scale-In."
  type        = number
  default     = 20
}

variable "alarm_period_seconds" {
  description = "Período de evaluación CloudWatch en segundos (300s coincide con Basic Monitoring gratuito)."
  type        = number
  default     = 300
}
