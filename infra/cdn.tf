# ACM certificate, the two CloudFront distributions and their CloudFront Functions.
#
# Two distributions: "site" (dual-stack) serves footprintz.fyi, and "ipv4" serves only
# /ip on ipv4.footprintz.fyi with IPv6 turned off. CloudFront then publishes no AAAA
# records for it, so a browser can only reach it over IPv4. The site asks both, so the
# report can show the IPv4 and IPv6 addresses as separate lines.
#
# Free flat-rate plan compatibility: cache *policies* only (no legacy
# forwarded_values), AWS-managed policies only, no access logs. The plan itself and
# its WAF rules are set in the console (Phase 4 Step 4), hence ignore_changes below.

# ── Certificate ──────────────────────────────────────────────────────────

resource "aws_acm_certificate" "site" {
  provider = aws.us_east_1 # CloudFront only accepts us-east-1 certificates

  domain_name               = var.domain
  subject_alternative_names = ["www.${var.domain}", "ipv4.${var.domain}"]
  validation_method         = "DNS"
  key_algorithm             = "EC_prime256v1" # smaller, faster handshakes than RSA 2048 (gitleaks:allow — algorithm name, not a key)

  lifecycle {
    create_before_destroy = true
  }
}

# Waits until ACM sees the validation CNAMEs (dns.tf) and issues the certificate.
resource "aws_acm_certificate_validation" "site" {
  provider = aws.us_east_1

  certificate_arn         = aws_acm_certificate.site.arn
  validation_record_fqdns = [for r in cloudflare_dns_record.acm_validation : r.name]
}

# ── Functions ────────────────────────────────────────────────────────────

# Viewer request on the default behaviour: www.footprintz.fyi → 301 → footprintz.fyi.
resource "aws_cloudfront_function" "www_redirect" {
  name    = "footprintz-www-redirect"
  runtime = "cloudfront-js-2.0"
  comment = "Redirect www to the apex"
  publish = true
  code    = file("${path.module}/functions/www-redirect.js")
}

# Viewer request on /ip (both distributions): answers with the visitor's IP; the
# request never reaches S3. Any other path gets a 404.
resource "aws_cloudfront_function" "ip" {
  name    = "footprintz-ip"
  runtime = "cloudfront-js-2.0"
  comment = "Return the viewer IP as text/plain, uncached; 404 elsewhere"
  publish = true
  code    = file("${path.module}/functions/ip.js")
}

# ── Managed cache policies ───────────────────────────────────────────────

data "aws_cloudfront_cache_policy" "caching_optimized" {
  name = "Managed-CachingOptimized"
}

data "aws_cloudfront_cache_policy" "caching_disabled" {
  name = "Managed-CachingDisabled"
}

# ── Distribution ─────────────────────────────────────────────────────────

resource "aws_cloudfront_origin_access_control" "site" {
  name                              = "footprintz-site"
  description                       = "CloudFront reads the private site bucket"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_distribution" "site" {
  enabled             = true
  comment             = "footprintz.fyi"
  aliases             = [var.domain, "www.${var.domain}"]
  default_root_object = "index.html" # only for "/"; keep the site flat (privacy.html)
  http_version        = "http2and3"
  is_ipv6_enabled     = true
  price_class         = "PriceClass_All" # the Free flat-rate plan sets this; all edges, no per-region pricing

  origin {
    origin_id                = "s3-site"
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_optimized.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.www_redirect.arn
    }
  }

  ordered_cache_behavior {
    path_pattern           = "/ip"
    target_origin_id       = "s3-site" # required, but ip.js answers before the origin
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_disabled.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.ip.arn
    }
  }

  # The bucket can't be listed, so a missing file is a 403: serve /404.html as a real 404.
  custom_error_response {
    error_code            = 403
    response_code         = 404
    response_page_path    = "/404.html"
    error_caching_min_ttl = 60
  }

  restrictions {
    geo_restriction {
      restriction_type = "none" # no country blocking: it would also block VPN and Tor exits
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  # The Free plan's web ACL is attached in the console (Step 4); don't let apply remove it.
  lifecycle {
    ignore_changes = [web_acl_id]
  }
}

# IPv4-only endpoint: ipv4.footprintz.fyi/ip. The function answers every request, so
# the origin is never reached (the bucket policy doesn't admit this distribution).
resource "aws_cloudfront_distribution" "ipv4" {
  enabled         = true
  comment         = "ipv4.footprintz.fyi (IPv4-only /ip)"
  aliases         = ["ipv4.${var.domain}"]
  http_version    = "http2and3"
  is_ipv6_enabled = false            # the point of this distribution: no AAAA records
  price_class     = "PriceClass_All" # what the Free flat-rate plan sets

  origin {
    origin_id                = "s3-site" # required by CloudFront; never used
    domain_name              = aws_s3_bucket.site.bucket_regional_domain_name
    origin_access_control_id = aws_cloudfront_origin_access_control.site.id
  }

  default_cache_behavior {
    target_origin_id       = "s3-site"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    compress               = true
    cache_policy_id        = data.aws_cloudfront_cache_policy.caching_disabled.id

    function_association {
      event_type   = "viewer-request"
      function_arn = aws_cloudfront_function.ip.arn
    }
  }

  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }

  viewer_certificate {
    acm_certificate_arn      = aws_acm_certificate_validation.site.certificate_arn
    ssl_support_method       = "sni-only"
    minimum_protocol_version = "TLSv1.2_2021"
  }

  lifecycle {
    ignore_changes = [web_acl_id]
  }
}
