# SES — transactional auth email for Supabase (magic links, password resets,
# invites), replacing Supabase's rate-limited shared mailer (DESIGN §10.2 A).
# Supabase points its custom SMTP at SES; this file just provisions the identity,
# DKIM, a custom MAIL FROM (for SPF alignment), and SMTP credentials.
#
# DNS is on Cloudflare (external), so the records below are added there by hand from
# the outputs — `terraform apply` does NOT wait on verification (no validation
# resource), so it won't hang the way an unvalidated ACM cert would.
#
# MANUAL STEPS after apply (`terraform output` shows the values):
#   1. Add the verification TXT, the 3 DKIM CNAMEs, and the MAIL FROM MX+TXT at
#      Cloudflare (DNS-only). SES verifies within minutes once they resolve.
#   2. (Recommended) add a DMARC TXT:  _dmarc.<mail_domain>  →  "v=DMARC1; p=none;"
#   3. Request SES production access in the console (SES → Account dashboard →
#      Request production access). Sandbox only delivers to verified addresses, so
#      invites to arbitrary friends fail until this is granted.
#   4. Supabase → Authentication → SMTP Settings: enter host/port/user/pass/sender
#      from the `ses_smtp_settings` output (sensitive).

variable "mail_domain" {
  type        = string
  description = "Domain SES sends from (must be DNS-managed at Cloudflare). Records are isolated subdomains, so this can be the app domain or the root."
  default     = "boxd.haneeftaher.com"
}

variable "mail_from_user" {
  type        = string
  description = "Local part of the From address Supabase sends as (e.g. noreply)."
  default     = "noreply"
}

resource "aws_ses_domain_identity" "app" {
  domain = var.mail_domain
}

resource "aws_ses_domain_dkim" "app" {
  domain = aws_ses_domain_identity.app.domain
}

# Custom MAIL FROM subdomain so SPF aligns to our domain (deliverability).
resource "aws_ses_domain_mail_from" "app" {
  domain           = aws_ses_domain_identity.app.domain
  mail_from_domain = "bounce.${var.mail_domain}"
}

# --- SMTP credentials: an IAM user whose SES SMTP password Supabase uses ---------
resource "aws_iam_user" "smtp" {
  name = "${local.name}-ses-smtp"
}

resource "aws_iam_user_policy" "smtp" {
  name = "${local.name}-ses-send"
  user = aws_iam_user.smtp.name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = "ses:SendRawEmail"
      Resource = "*"
    }]
  })
}

resource "aws_iam_access_key" "smtp" {
  user = aws_iam_user.smtp.name
}

# --- Outputs: records to add at Cloudflare, and the Supabase SMTP settings -------

output "ses_verification_record" {
  description = "Add at Cloudflare (DNS-only) to verify the SES domain identity."
  value = {
    name  = "_amazonses.${var.mail_domain}"
    type  = "TXT"
    value = aws_ses_domain_identity.app.verification_token
  }
}

output "ses_dkim_records" {
  description = "Add these 3 CNAMEs at Cloudflare (DNS-only) for DKIM signing."
  value = [for t in aws_ses_domain_dkim.app.dkim_tokens : {
    name  = "${t}._domainkey.${var.mail_domain}"
    type  = "CNAME"
    value = "${t}.dkim.amazonses.com"
  }]
}

output "ses_mail_from_records" {
  description = "MAIL FROM MX + SPF — add at Cloudflare (DNS-only)."
  value = [
    {
      name  = aws_ses_domain_mail_from.app.mail_from_domain
      type  = "MX"
      value = "10 feedback-smtp.${var.aws_region}.amazonses.com"
    },
    {
      name  = aws_ses_domain_mail_from.app.mail_from_domain
      type  = "TXT"
      value = "v=spf1 include:amazonses.com ~all"
    },
  ]
}

output "ses_smtp_settings" {
  description = "Enter in Supabase → Authentication → SMTP Settings."
  sensitive   = true
  value = {
    host     = "email-smtp.${var.aws_region}.amazonaws.com"
    port     = 587
    username = aws_iam_access_key.smtp.id
    password = aws_iam_access_key.smtp.ses_smtp_password_v4
    sender   = "${var.mail_from_user}@${var.mail_domain}"
  }
}
