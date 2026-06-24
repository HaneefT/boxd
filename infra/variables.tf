variable "aws_region" {
  type        = string
  description = "AWS region for all resources."
  default     = "us-east-1"
}

variable "project" {
  type        = string
  description = "Name prefix for resources."
  default     = "boxd-stats"
}

variable "supabase_url" {
  type        = string
  description = "Supabase project URL, e.g. https://<ref>.supabase.co"
}

variable "supabase_jwt_issuer" {
  type        = string
  description = "Issuer (iss) claim of Supabase access tokens — usually <supabase_url>/auth/v1"
}

variable "supabase_service_role_key" {
  type        = string
  description = "Supabase service_role key (server-only; bypasses RLS)."
  sensitive   = true
}

variable "tmdb_api_key" {
  type        = string
  description = "TMDB v3 API key for enrichment."
  sensitive   = true
}

variable "spa_cors_origins" {
  type        = list(string)
  description = "Allowed CORS origins for the upload API (the SPA's origins)."
  default = [
    "http://localhost:5173",
    "https://boxd.haneeftaher.com",
    "https://d3guxnyl53xxn0.cloudfront.net",
  ]
}

variable "app_domain" {
  type        = string
  description = "Custom domain for the SPA (CloudFront alternate domain name)."
  default     = "boxd.haneeftaher.com"
}

