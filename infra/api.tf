# API: the scores table, the Lambda function, its role, logs and URL.  # what this file is for
# CloudFront reaches the function through its URL with origin access control (cdn.tf).  # how requests arrive
# The URL requires IAM signatures, so a direct call that skips CloudFront gets 403.       # why it can't be called directly
# Cost caps: fixed table capacity (no auto scaling) and at most 5 copies running at once. # what keeps the bill bounded

locals {                       # values used more than once in this file
  api_name  = "footprintz-api" # the function's name, also part of its log group name
  max_score = 1000000          # highest score POST /api/scores accepts; placeholder until Pachinko's scoring is set
}                              # end of the values

# ── Table ────────────────────────────────────────────────────────────────────────

resource "aws_dynamodb_table" "scores" {            # create the scoreboard table
  name                        = "footprintz-scores" # its name in the console
  billing_mode                = "PROVISIONED"       # pay for fixed capacity, which is also a hard cap (free tier: 25 + 25)
  read_capacity               = 2                   # 2 reads per second; past that DynamoDB refuses (API answers 503)
  write_capacity              = 2                   # 2 writes per second; same
  hash_key                    = "board"             # partition key: which game's board ("pachinko")
  range_key                   = "rank"              # sort key: score#reversed-time#id, so rows sort like the scoreboard
  deletion_protection_enabled = true                # DynamoDB refuses to delete the table until this is turned off

  attribute {      # the partition key's type
    name = "board" # attribute name
    type = "S"     # S = string
  }                # end of the partition key

  attribute {     # the sort key's type
    name = "rank" # attribute name
    type = "S"    # string; the code zero-pads numbers so text order = number order
  }               # end of the sort key

  point_in_time_recovery { # continuous backups
    enabled = false        # off: it's a paid feature and the scores aren't worth it
  }                        # end of backups
}                          # end of the table; no server_side_encryption block = AWS-owned key (free)

# ── Logs ─────────────────────────────────────────────────────────────────────────

resource "aws_cloudwatch_log_group" "api" {           # where the function's output goes
  name              = "/aws/lambda/${local.api_name}" # the name Lambda would pick itself, so nothing else creates it
  retention_in_days = 14                              # delete logs after 14 days (stays in the free 5 GB)
}                                                     # end of the log group

# ── Role ─────────────────────────────────────────────────────────────────────────

data "aws_iam_policy_document" "api_trust" { # who may take on the function's role
  statement {                                # one rule
    actions = ["sts:AssumeRole"]             # the action: borrow the role's permissions
    principals {                             # who the rule is about
      type        = "Service"                # an AWS service
      identifiers = ["lambda.amazonaws.com"] # Lambda, when it runs this function
    }                                        # end of "who"
  }                                          # end of the rule
}                                            # end of the trust rules

data "aws_iam_policy_document" "api_permissions" {            # what the function may do
  statement {                                                 # permission 1
    sid       = "ReadWriteScores"                             # a label
    actions   = ["dynamodb:Query", "dynamodb:PutItem"]        # read the top rows, add one row; no update, delete or scan
    resources = [aws_dynamodb_table.scores.arn]               # only the scores table
  }                                                           # end of permission 1
  statement {                                                 # permission 2
    sid       = "WriteLogs"                                   # a label
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"] # write its own log lines
    resources = ["${aws_cloudwatch_log_group.api.arn}:*"]     # only streams inside its log group
  }                                                           # end of permission 2
}                                                             # end of the permission list

resource "aws_iam_role" "api" {                                               # the role the function runs as
  name               = local.api_name                                         # its name in the console
  description        = "footprintz-api Lambda: scores table and its own logs" # a note shown in the console
  assume_role_policy = data.aws_iam_policy_document.api_trust.json            # only Lambda may use it
}                                                                             # end of the role

resource "aws_iam_role_policy" "api" {                       # attach the permissions to the role
  name   = "api-scores"                                      # a name for the attached permissions
  role   = aws_iam_role.api.id                               # the role above
  policy = data.aws_iam_policy_document.api_permissions.json # the two permissions above
}                                                            # end of the attachment

# ── Function ─────────────────────────────────────────────────────────────────────

data "archive_file" "api" {                             # zip the built binary (Phase 5A Step 2 builds it)
  type        = "zip"                                   # Lambda takes code as a zip file
  source_file = "${path.module}/../api/build/bootstrap" # the Go binary; plan fails if it hasn't been built
  output_path = "${path.module}/../api/build/api.zip"   # the zip, next to it (build/ is gitignored)
}                                                       # end of the zip

resource "aws_lambda_function" "api" {                                            # create the function
  function_name                  = local.api_name                                 # its name
  description                    = "Footprintz data API behind CloudFront /api/*" # a note shown in the console
  role                           = aws_iam_role.api.arn                           # run with the role above
  runtime                        = "provided.al2023"                              # Amazon Linux 2023, no language runtime: runs our binary
  handler                        = "bootstrap"                                    # not used by provided runtimes; "bootstrap" by convention
  architectures                  = ["arm64"]                                      # Graviton: cheaper per second than x86
  filename                       = data.archive_file.api.output_path              # the zip made above
  source_code_hash               = data.archive_file.api.output_base64sha256      # a new binary changes this, so apply uploads it
  memory_size                    = 128                                            # MB; the smallest size, plenty for this
  timeout                        = 3                                              # seconds before Lambda stops a stuck request
  reserved_concurrent_executions = 5                                              # at most 5 at once; needs the account limit raised (quota case)

  environment {                                   # settings the code reads at start-up
    variables = {                                 # name = value
      TABLE_NAME = aws_dynamodb_table.scores.name # which table to use
      MAX_SCORE  = tostring(local.max_score)      # the plausibility cap, as text
    }                                             # end of the settings
  }                                               # end of environment

  logging_config {                                 # where logs go
    log_format = "Text"                            # plain lines, as the code writes them
    log_group  = aws_cloudwatch_log_group.api.name # the log group above (14-day retention)
  }                                                # end of logging

  depends_on = [aws_iam_role_policy.api] # attach the permissions first, so the first run can write logs
}                                        # end of the function

resource "aws_lambda_function_url" "api" {                   # an HTTPS address for the function
  function_name      = aws_lambda_function.api.function_name # for this function
  authorization_type = "AWS_IAM"                             # callers must sign with AWS credentials (CloudFront does, via OAC)
}                                                            # end of the URL; no CORS: the site and API share footprintz.fyi

# ── Let CloudFront call it ───────────────────────────────────────────────────────
# Function URLs created since October 2025 need both permissions (Lambda developer guide).

resource "aws_lambda_permission" "cloudfront_url" {              # permission 1: call the function's URL
  statement_id           = "AllowCloudFrontFunctionUrl"          # a label in the function's policy
  action                 = "lambda:InvokeFunctionUrl"            # the URL-call action
  function_name          = aws_lambda_function.api.function_name # this function
  principal              = "cloudfront.amazonaws.com"            # the CloudFront service
  source_arn             = aws_cloudfront_distribution.site.arn  # only the footprintz.fyi distribution
  function_url_auth_type = "AWS_IAM"                             # matches the URL's auth type
}                                                                # end of permission 1

resource "aws_lambda_permission" "cloudfront_invoke" {             # permission 2: run the function behind the URL
  statement_id             = "AllowCloudFrontInvokeViaUrl"         # a label in the function's policy
  action                   = "lambda:InvokeFunction"               # the run action
  function_name            = aws_lambda_function.api.function_name # this function
  principal                = "cloudfront.amazonaws.com"            # the CloudFront service
  source_arn               = aws_cloudfront_distribution.site.arn  # only the footprintz.fyi distribution
  invoked_via_function_url = true                                  # only when it comes in through the URL
}                                                                  # end of permission 2
