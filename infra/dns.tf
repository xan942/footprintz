# Cloudflare DNS records. All DNS-only (proxied = false): CloudFront terminates TLS
# with the ACM certificate, and Cloudflare's proxy would hide the visitor's IP from
# the /ip function.
#
# Dangling-DNS rule: these records reference the certificate and distribution, so
# OpenTofu creates them after those exist and deletes them first on teardown.

data "cloudflare_zone" "site" {
  filter = {
    name = var.domain
  }
}

# ACM DNS-validation CNAMEs, one per name on the certificate (apex and www).
resource "cloudflare_dns_record" "acm_validation" {
  for_each = {
    for dvo in aws_acm_certificate.site.domain_validation_options : dvo.domain_name => dvo
  }

  zone_id = data.cloudflare_zone.site.id
  name    = trimsuffix(each.value.resource_record_name, ".")
  type    = each.value.resource_record_type
  content = trimsuffix(each.value.resource_record_value, ".")
  ttl     = 1 # 1 = automatic
  proxied = false
  comment = "ACM validation for the CloudFront certificate (OpenTofu)"
}

# Apex → CloudFront. Cloudflare flattens a CNAME at the apex into A/AAAA answers.
resource "cloudflare_dns_record" "apex" {
  zone_id = data.cloudflare_zone.site.id
  name    = var.domain
  type    = "CNAME"
  content = aws_cloudfront_distribution.site.domain_name
  ttl     = 1
  proxied = false
  comment = "Site → CloudFront (OpenTofu)"
}

# www → CloudFront; the www-redirect function sends it on to the apex.
resource "cloudflare_dns_record" "www" {
  zone_id = data.cloudflare_zone.site.id
  name    = "www.${var.domain}"
  type    = "CNAME"
  content = aws_cloudfront_distribution.site.domain_name
  ttl     = 1
  proxied = false
  comment = "www → CloudFront, redirected to the apex (OpenTofu)"
}
