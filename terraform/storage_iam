resource "random_string" "assets_suffix" {
  length  = 8
  special = false
  upper   = false
}

# Bucket S3 privado para entregar los archivos web/agent a las instancias al arrancar
resource "aws_s3_bucket" "web_assets" {
  bucket        = "${var.project_name}-assets-${random_string.assets_suffix.result}"
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "web_assets" {
  bucket = aws_s3_bucket.web_assets.id

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_server_side_encryption_configuration" "web_assets" {
  bucket = aws_s3_bucket.web_assets.id

  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

locals {
  web_files = {
    "index.html" = "text/html; charset=utf-8"
    "styles.css" = "text/css; charset=utf-8"
    "app.js"     = "application/javascript; charset=utf-8"
    "agent.py"   = "text/x-python"
  }
}

resource "aws_s3_object" "web_assets" {
  for_each     = local.web_files
  bucket       = aws_s3_bucket.web_assets.id
  key          = "web/${each.key}"
  source       = "${path.module}/../web/${each.key}"
  etag         = filemd5("${path.module}/../web/${each.key}")
  content_type = each.value
}

# Rol IAM mínimo para instancias EC2 (SSM + lectura exclusiva del bucket de assets)
resource "aws_iam_role" "ec2_role" {
  name = "${var.project_name}-ec2-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Action = "sts:AssumeRole"
        Effect = "Allow"
        Principal = {
          Service = "ec2.amazonaws.com"
        }
      }
    ]
  })
}

resource "aws_iam_role_policy_attachment" "ssm_core" {
  role       = aws_iam_role.ec2_role.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy" "s3_assets_read" {
  name = "${var.project_name}-s3-assets-read"
  role = aws_iam_role.ec2_role.id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["s3:GetObject"]
        Resource = "${aws_s3_bucket.web_assets.arn}/*"
      },
      {
        Effect   = "Allow"
        Action   = ["s3:ListBucket"]
        Resource = aws_s3_bucket.web_assets.arn
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "${var.project_name}-ec2-profile"
  role = aws_iam_role.ec2_role.name
}
