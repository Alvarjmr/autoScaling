# Reutiliza el backend remoto S3 + DynamoDB creado por el bootstrap de `agentes`
# usando una clave de estado independiente (autoscaling/prod/terraform.tfstate).
terraform {
  backend "s3" {}
}
