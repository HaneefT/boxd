# Run terraform with variables sourced from the repo-root .env, so secrets live
# only in .env (no terraform.tfvars copy). Terraform reads any TF_VAR_* env var.
#
#   ./tf.ps1 init
#   ./tf.ps1 plan
#   ./tf.ps1 apply
#
# (bash equivalent: set -a; . ../.env; set +a, then export the TF_VAR_* below.)

param([Parameter(ValueFromRemainingArguments = $true)] $TfArgs)

$ErrorActionPreference = "Stop"
$envPath = Join-Path $PSScriptRoot "..\.env"
if (-not (Test-Path $envPath)) { throw "no .env at $envPath" }

Get-Content $envPath | ForEach-Object {
  $line = $_.Trim()
  if ($line -and -not $line.StartsWith("#") -and $line.Contains("=")) {
    $k, $v = $line.Split("=", 2)
    Set-Item -Path "Env:$($k.Trim())" -Value $v.Trim()
  }
}

# Map .env -> Terraform variables (issuer is derived from the project URL).
$env:TF_VAR_aws_region                = $env:AWS_REGION
$env:TF_VAR_supabase_url              = $env:SUPABASE_URL
$env:TF_VAR_supabase_jwt_issuer       = "$($env:SUPABASE_URL)/auth/v1"
$env:TF_VAR_supabase_service_role_key = $env:SUPABASE_SERVICE_ROLE_KEY
$env:TF_VAR_tmdb_api_key              = $env:TMDB_API_KEY
$env:TF_VAR_basic_auth_user           = $env:BASIC_AUTH_USER
$env:TF_VAR_basic_auth_password       = $env:BASIC_AUTH_PASSWORD

terraform @TfArgs
