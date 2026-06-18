# Pre-launch gate: HTTP Basic Auth in front of the SPA via a CloudFront Function
# (viewer-request). Blocks the public from stumbling onto the site; you + friends
# get in with the shared credentials (in .env as BASIC_AUTH_*). Remove the
# function_association in frontend.tf (and this file) to open the site at launch.
#
# CloudFront Functions have no runtime env, so the expected Authorization header
# is computed at deploy time and baked into the code (state is private anyway).

locals {
  basic_auth_expected = "Basic ${base64encode("${var.basic_auth_user}:${var.basic_auth_password}")}"
}

resource "aws_cloudfront_function" "basic_auth" {
  name    = "${local.name}-basic-auth"
  runtime = "cloudfront-js-2.0"
  comment = "Pre-launch HTTP Basic Auth gate for the SPA"
  publish = true
  code    = <<-EOT
    function handler(event) {
      var request = event.request;
      var headers = request.headers;
      var expected = "${local.basic_auth_expected}";
      if (headers.authorization && headers.authorization.value === expected) {
        return request;
      }
      return {
        statusCode: 401,
        statusDescription: "Unauthorized",
        headers: {
          "www-authenticate": { value: "Basic realm=\"Boxd Stats (pre-launch)\"" }
        }
      };
    }
  EOT
}
