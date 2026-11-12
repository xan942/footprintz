# GitHub Actions deploy access (Phase 5 Step 5).                                    # what this file is for
# GitHub proves who it is with a short-lived signed token (OIDC); no AWS keys are    # why no passwords or keys
# stored anywhere. The role it gets can only update the site bucket and clear the    # what the role may do
# main distribution's cache, and only workflows on the main branch can use it.       # who may use it

# ── Trust GitHub's sign-in tokens ────────────────────────────────────────────────

resource "aws_iam_openid_connect_provider" "github" {            # register GitHub as a trusted sign-in source in this AWS account
  url            = "https://token.actions.githubusercontent.com" # the address GitHub signs its tokens from
  client_id_list = ["sts.amazonaws.com"]                         # tokens must be meant for AWS's sign-in service
}                                                                # end of the GitHub sign-in source

# ── Who may use the role ─────────────────────────────────────────────────────────

data "aws_iam_policy_document" "deploy_trust" {                  # the rule deciding who may take on the deploy role
  statement {                                                    # one rule
    actions = ["sts:AssumeRoleWithWebIdentity"]                  # the action: trade a GitHub token for temporary AWS credentials
    principals {                                                 # who the rule is about
      type        = "Federated"                                  # an outside sign-in system, not an AWS user
      identifiers = [aws_iam_openid_connect_provider.github.arn] # specifically the GitHub source registered above
    }                                                            # end of "who"
    condition {                                                  # requirement 1
      test     = "StringEquals"                                  # the value must match exactly
      variable = "token.actions.githubusercontent.com:aud"       # the token's "audience" (who it was issued for)
      values   = ["sts.amazonaws.com"]                           # must be AWS's sign-in service
    }                                                            # end of requirement 1
    condition {                                                  # requirement 2
      test     = "StringEquals"                                  # the value must match exactly (no wildcards)
      variable = "token.actions.githubusercontent.com:sub"       # the token's "subject": which repo and branch is asking
      values   = ["repo:${var.github_repo}:ref:refs/heads/main"] # only this repo, only the main branch
    }                                                            # end of requirement 2
  }                                                              # end of the rule
}                                                                # end of the trust rules

# ── What the role may do ─────────────────────────────────────────────────────────

data "aws_iam_policy_document" "deploy_permissions" {  # the list of things the role is allowed to do
  statement {                                          # permission 1
    sid       = "ListSiteBucket"                       # a label for this permission
    actions   = ["s3:ListBucket"]                      # see which files are already in the bucket (to know what changed)
    resources = [aws_s3_bucket.site.arn]               # only in the site bucket
  }                                                    # end of permission 1
  statement {                                          # permission 2
    sid       = "WriteSiteFiles"                       # a label for this permission
    actions   = ["s3:PutObject", "s3:DeleteObject"]    # upload new or changed files; delete removed ones
    resources = ["${aws_s3_bucket.site.arn}/*"]        # only files inside the site bucket
  }                                                    # end of permission 2
  statement {                                          # permission 3
    sid       = "ClearCache"                           # a label for this permission
    actions   = ["cloudfront:CreateInvalidation"]      # tell CloudFront to drop its cached copies
    resources = [aws_cloudfront_distribution.site.arn] # only the main site distribution
  }                                                    # end of permission 3
}                                                      # end of the permission list

# ── The role itself ──────────────────────────────────────────────────────────────

resource "aws_iam_role" "deploy" {                                                  # create the deploy role
  name                 = "footprintz-github-deploy"                                 # its name in the AWS console
  description          = "GitHub Actions on main: upload site/ and clear the cache" # a note shown in the console
  assume_role_policy   = data.aws_iam_policy_document.deploy_trust.json             # attach the "who may use it" rules
  max_session_duration = 3600                                                       # credentials it hands out expire after 1 hour
}                                                                                   # end of the role

resource "aws_iam_role_policy" "deploy" {                       # attach the permission list to the role
  name   = "deploy-site"                                        # a name for the attached permissions
  role   = aws_iam_role.deploy.id                               # attach to the deploy role above
  policy = data.aws_iam_policy_document.deploy_permissions.json # the three permissions listed above
}                                                               # end of the attachment
