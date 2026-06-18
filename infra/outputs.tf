output "process_url" {
  description = "POST {\"path\":\"<uid>/export.zip\"} here (Authorization: Bearer <supabase token>) after uploading the ZIP to Storage."
  value       = "${aws_apigatewayv2_api.http.api_endpoint}/process"
}

output "api_endpoint" {
  description = "Base URL of the HTTP API."
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "cloudfront_domain" {
  description = "CloudFront domain serving the SPA."
  value       = aws_cloudfront_distribution.spa.domain_name
}

output "spa_bucket" {
  description = "S3 bucket to sync frontend/dist into."
  value       = aws_s3_bucket.spa.bucket
}
