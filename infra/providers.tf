# Providers and state encryption for Footprintz.
#
# Regions: the org's region-lock SCP allows regional services only in
# us-east-2, so that is the default. CloudFront accepts certificates only from
# us-east-1, so the ACM certificate uses the aliased provider below (the SCP allows
# acm:* there).
#
# Credentials come from the environment, never from files in this repo:
#   AWS_PROFILE=footprintz              (Identity Center SSO profile)
#   CLOUDFLARE_API_TOKEN=…              (token footprintz-tofu: footprintz.fyi, DNS Edit)
#   TF_VAR_state_passphrase=…           (encrypts state and plan files)

terraform {
  required_version = ">= 1.8" # variables inside the encryption block need 1.8+

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }

  # State and saved plans are encrypted at rest. The state holds every resource ID
  # (and, from Phase 6, the origin secret), so it is never readable without the
  # passphrase. Losing the passphrase means losing the state: keep it in a password manager.
  encryption {
    key_provider "pbkdf2" "main" {
      passphrase = var.state_passphrase
    }

    method "aes_gcm" "main" {
      keys = key_provider.pbkdf2.main
    }

    state {
      method   = method.aes_gcm.main
      enforced = true # refuse to write an unencrypted state
    }

    plan {
      method   = method.aes_gcm.main
      enforced = true # refuse to write an unencrypted plan file
    }
  }
}

# Default AWS provider: everything regional (S3 now; EC2 and DynamoDB later).
provider "aws" {
  region = "us-east-2"

  default_tags {
    tags = {
      project = "footprintz"
    }
  }
}

# us-east-1, used only for the CloudFront certificate.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"

  default_tags {
    tags = {
      project = "footprintz"
    }
  }
}

# Reads CLOUDFLARE_API_TOKEN from the environment.
provider "cloudflare" {}
