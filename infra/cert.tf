# Custom domain for the SPA: boxd.haneeftaher.com via CloudFront.
# ACM cert MUST be in us-east-1 for CloudFront (this stack already is).
# DNS is on Cloudflare (external), so validation records are added there by hand;
# aws_acm_certificate_validation just waits for ACM to see them and issue.

resource "aws_acm_certificate" "app" {
  domain_name       = var.app_domain
  validation_method = "DNS"
  lifecycle {
    create_before_destroy = true
  }
}

resource "aws_acm_certificate_validation" "app" {
  certificate_arn = aws_acm_certificate.app.arn
}

output "acm_validation_records" {
  description = "Add these CNAME record(s) at Cloudflare (DNS-only) to validate the cert."
  value = [for o in aws_acm_certificate.app.domain_validation_options : {
    name  = o.resource_record_name
    type  = o.resource_record_type
    value = o.resource_record_value
  }]
}

output "app_url" {
  description = "Public app URL once DNS + CloudFront alias are live."
  value       = "https://${var.app_domain}"
}
