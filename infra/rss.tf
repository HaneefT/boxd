# Daily RSS incremental sync (DESIGN §2.4, D9). Reuses the upload Lambda's package
# (process_upload) with a different handler; an EventBridge cron fires it once a day.
# Polls each opted-in member's PUBLIC Letterboxd RSS feed and appends new diary entries.

resource "aws_iam_role" "rss_poll" {
  name               = "${local.name}-rss-poll"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume.json
}

resource "aws_iam_role_policy_attachment" "rss_poll_logs" {
  role       = aws_iam_role.rss_poll.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

resource "aws_lambda_function" "rss_poll" {
  function_name    = "${local.name}-rss-poll"
  role             = aws_iam_role.rss_poll.arn
  runtime          = "python3.12"
  handler          = "process_upload.rss_sync.lambda_handler"
  filename         = data.archive_file.lambda.output_path # same package as the upload Lambda
  source_code_hash = data.archive_file.lambda.output_base64sha256
  timeout          = 120 # fetch feeds + enrich new films + recompute snapshots, all users
  memory_size      = 256

  environment {
    variables = {
      SUPABASE_URL              = var.supabase_url
      SUPABASE_SERVICE_ROLE_KEY = var.supabase_service_role_key
      TMDB_API_KEY              = var.tmdb_api_key
    }
  }
}

resource "aws_cloudwatch_log_group" "rss_poll" {
  name              = "/aws/lambda/${aws_lambda_function.rss_poll.function_name}"
  retention_in_days = 7 # cost trap #3 — don't keep logs forever
}

resource "aws_cloudwatch_event_rule" "rss_daily" {
  name                = "${local.name}-rss-daily"
  schedule_expression = "rate(1 day)" # polite cadence (DESIGN §2.4: ≤1–2×/day)
}

resource "aws_cloudwatch_event_target" "rss_poll" {
  rule      = aws_cloudwatch_event_rule.rss_daily.name
  target_id = "rss-poll-lambda"
  arn       = aws_lambda_function.rss_poll.arn
}

resource "aws_lambda_permission" "rss_events" {
  statement_id  = "AllowEventBridgeInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rss_poll.function_name
  principal     = "events.amazonaws.com"
  source_arn    = aws_cloudwatch_event_rule.rss_daily.arn
}
