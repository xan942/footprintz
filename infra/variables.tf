# The passphrase that encrypts OpenTofu state and plan files.
# Set through the environment, never a .tfvars file:
#   bash: read -rs TF_VAR_state_passphrase && export TF_VAR_state_passphrase
#   fish: read -s -x TF_VAR_state_passphrase
variable "state_passphrase" {
  type      = string
  sensitive = true # OpenTofu shows "(sensitive value)" instead of the passphrase

  validation {
    condition     = length(var.state_passphrase) >= 16
    error_message = "Use a passphrase of at least 16 characters."
  }
}

# The site's domain. Apex and www both point at the distribution; www redirects to the apex.
variable "domain" {
  type    = string
  default = "footprintz.fyi"
}

# The GitHub repository allowed to deploy, as owner/name. Used by deploy.tf.          # what this setting is and where it's used
variable "github_repo" {        # declare a setting named github_repo
  type    = string              # it holds text
  default = "xan942/footprintz" # the value: this project's repository
}                               # end of the setting
