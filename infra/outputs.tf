# Used by the deploy commands (Phase 4 Step 5):
#   aws s3 sync site/ "s3://$(tofu -chdir=infra output -raw site_bucket)" --delete
#   aws cloudfront create-invalidation --distribution-id "$(tofu -chdir=infra output -raw distribution_id)" --paths "/*"

output "site_bucket" {
  description = "S3 bucket that holds site/"
  value       = aws_s3_bucket.site.bucket
}

output "distribution_id" {
  description = "CloudFront distribution ID (for invalidations)"
  value       = aws_cloudfront_distribution.site.id
}

output "ipv4_distribution_id" {
  description = "CloudFront distribution ID of the IPv4-only /ip endpoint"
  value       = aws_cloudfront_distribution.ipv4.id
}

output "distribution_domain" {
  description = "CloudFront domain the DNS records point at"
  value       = aws_cloudfront_distribution.site.domain_name
}
