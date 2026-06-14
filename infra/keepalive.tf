# Daily ping so the Supabase free-tier project doesn't pause (DESIGN 5.3).

data "archive_file" "keepalive" {
  type        = "zip"
  source_file = "${path.module}/keepalive.py"
  output_path = "${path.module}/build/keepalive.zip"
}

resource "aws_iam_role" "keepalive" {
  name               = "${local.name}-keepalive"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "keepalive_logs" {
  role       = aws_iam_role.keepalive.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "keepalive" {
  function_name    = "${local.name}-keepalive"
  role             = aws_iam_role.keepalive.arn
  runtime          = "python3.12"
  handler          = "keepalive.handler"
  filename         = data.archive_file.keepalive.output_path
  source_code_hash = data.archive_file.keepalive.output_base64sha256
  timeout          = 15

  environment {
    variables = {
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
    }
  }
}

resource "aws_cloudwatch_event_rule" "keepalive_daily" {
  name                = "${local.name}-keepalive-daily"
  schedule_expression = "rate(1 day)"
}

resource "aws_cloudwatch_event_target" "keepalive" {
  rule      = aws_cloudwatch_event_rule.keepalive_daily.name
  target_id = "keepalive-lambda"
  arn       = aws_lambda_function.keepalive.arn
}

resource "aws_lambda_permission" "keepalive_events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.keepalive.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.keepalive_daily.arn
}
