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

# The GitHub repository allowed to deploy, in GitHub's immutable-subject form:              # what this setting is
# owner@<owner ID>/repo@<repo ID>. The repo's OIDC tokens use this form, and the IDs        # why it has numbers in it
# never change, so a renamed or re-created repo with the same name can't deploy.            # why that's safer
# Check with: gh api repos/xan942/footprintz/actions/oidc/customization/sub                 # how to look the IDs up
variable "github_repo" {                             # declare a setting named github_repo
  type    = string                                   # it holds text
  default = "xan942@216507896/footprintz@1418705982" # the value: this project's repository, with its permanent IDs
}                                                    # end of the setting
