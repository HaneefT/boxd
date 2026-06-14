# --- Package the process_upload Lambda --------------------------------------

resource "null_resource" "lambda_build" {
  # Re-stage whenever any source file changes.
  triggers = {
    sources = sha1(join("", [
      for f in fileset("${path.module}/../backend/process_upload", "**/*.py") :
      filesha1("${path.module}/../backend/process_upload/${f}")
    ]))
  }
  provisioner "local-exec" {
    command = "python \"${path.module}/build_lambda.py\""
  }
}

data "archive_file" "lambda" {
  type        = "zip"
  source_dir  = "${path.module}/build/pkg"
  output_path = "${path.module}/build/lambda.zip"
  depends_on  = [null_resource.lambda_build]
}

# --- IAM (basic execution: CloudWatch Logs only; Supabase/TMDB are external) -

data "aws_iam_policy_document" "lambda_assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "upload" {
  name               = "${local.name}-upload"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "upload_logs" {
  role       = aws_iam_role.upload.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Function ----------------------------------------------------------------

resource "aws_lambda_function" "upload" {
  function_name    = "${local.name}-upload"
  role             = aws_iam_role.upload.arn
  runtime          = "python3.12"
  handler          = "process_upload.handler.lambda_handler"
  filename         = data.archive_file.lambda.output_path
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 300 # cold first upload enriches the whole library (DESIGN 4.4)
  memory_size      = 512

  environment {
    variables = {
      TMDB_API_KEY              = var.tmdb_api_key
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    }
  }
}

resource "aws_cloudwatch_log_group" "upload" {
  name              = "/aws/lambda/${aws_lambda_function.upload.function_name}"
  retention_in_days = 14
}
