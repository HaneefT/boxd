# SES cost/abuse guardrail. SES is pay-per-send ($0.10/1k, no idle cost), so the real
# risk isn't organic spend — it's a runaway loop or compromised key blasting email,
# which racks up cost AND torches sender reputation. This watches email *volume* (reacts
# in minutes, unlike billing alarms which lag hours): if SES sends more than the hourly
# limit, it (1) emails you and (2) auto-pauses ALL SES sending via a tiny Lambda.
# Re-enable after investigating:  aws sesv2 put-account-sending-attributes --sending-enabled

variable "alert_email" {
  description = "Where to send the SES guardrail alert (must be confirmed via the SNS opt-in email)."
  type        = string
  default     = "haneeft2403@gmail.com"
}

variable "ses_hourly_send_limit" {
  description = "Trip the alarm + auto-pause if SES sends more than this many emails in one hour (far above friends-scale)."
  type        = number
  default     = 100
}

resource "aws_sns_topic" "ses_guardrail" {
  name = "boxd-stats-ses-guardrail"
}

# Email notification. AWS sends a one-time confirmation link to alert_email — you must
# click it before notifications (and only notifications; the Lambda fires regardless).
resource "aws_sns_topic_subscription" "ses_guardrail_email" {
  topic_arn = aws_sns_topic.ses_guardrail.arn
  protocol  = "email"
  endpoint  = var.alert_email
}

# --- Auto-disable Lambda ---
data "archive_file" "ses_guardrail" {
  type        = "zip"
  source_file = "${path.module}/ses_guardrail_lambda/handler.py"
  output_path = "${path.module}/build/ses_guardrail.zip"
}

resource "aws_iam_role" "ses_guardrail" {
  name = "boxd-stats-ses-guardrail"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Principal = { Service = "lambda.amazonaws.com" }
      Action    = "sts:AssumeRole"
    }]
  })
}

resource "aws_iam_role_policy" "ses_guardrail" {
  name = "ses-guardrail"
  role = aws_iam_role.ses_guardrail.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect   = "Allow"
        Action   = ["ses:UpdateAccountSendingEnabled", "ses:PutAccountSendingAttributes"]
        Resource = "*"
      },
      {
        Effect   = "Allow"
        Action   = ["logs:CreateLogGroup", "logs:CreateLogStream", "logs:PutLogEvents"]
        Resource = "arn:aws:logs:*:*:*"
      }
    ]
  })
}

resource "aws_lambda_function" "ses_guardrail" {
  function_name    = "boxd-stats-ses-guardrail"
  role             = aws_iam_role.ses_guardrail.arn
  runtime          = "python3.12"
  handler          = "handler.lambda_handler"
  filename         = data.archive_file.ses_guardrail.output_path
  source_code_hash = data.archive_file.ses_guardrail.output_base64sha256
  timeout          = 30
}

resource "aws_cloudwatch_log_group" "ses_guardrail" {
  name              = "/aws/lambda/${aws_lambda_function.ses_guardrail.function_name}"
  retention_in_days = 7 # avoid the log-retention cost trap (DESIGN §5.3)
}

resource "aws_sns_topic_subscription" "ses_guardrail_lambda" {
  topic_arn = aws_sns_topic.ses_guardrail.arn
  protocol  = "lambda"
  endpoint  = aws_lambda_function.ses_guardrail.arn
}

resource "aws_lambda_permission" "ses_guardrail_sns" {
  statement_id  = "AllowSNSInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.ses_guardrail.function_name
  principal     = "sns.amazonaws.com"
  source_arn    = aws_sns_topic.ses_guardrail.arn
}

# --- The alarm: SES Send count over a rolling hour ---
# AWS/SES publishes the account-level Send metric automatically (no config set needed).
resource "aws_cloudwatch_metric_alarm" "ses_volume" {
  alarm_name          = "boxd-stats-ses-volume"
  alarm_description   = "SES sent > ${var.ses_hourly_send_limit} emails in an hour — sending auto-paused; investigate then re-enable with: aws sesv2 put-account-sending-attributes --sending-enabled"
  namespace           = "AWS/SES"
  metric_name         = "Send"
  statistic           = "Sum"
  period              = 3600
  evaluation_periods  = 1
  threshold           = var.ses_hourly_send_limit
  comparison_operator = "GreaterThanThreshold"
  treat_missing_data  = "notBreaching" # no email sent for an hour = fine, not an alarm
  alarm_actions       = [aws_sns_topic.ses_guardrail.arn]
}

output "ses_guardrail_topic_arn" {
  value = aws_sns_topic.ses_guardrail.arn
}
