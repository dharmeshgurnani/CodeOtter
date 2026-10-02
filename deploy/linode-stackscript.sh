#!/bin/bash
# CodeOtter StackScript for Akamai/Linode. Publish it public at cloud.linode.com/stackscripts/create (Ubuntu 24.04).
# <UDF name="domain" label="Domain with an A record pointing at this Linode. Blank uses the Linode's own hostname." default="" />
# <UDF name="gh_token" label="GitHub token (optional, can be set in the app)" default="" />
# <UDF name="llm_api_key" label="Language model API key (optional, can be set in the app)" default="" />
set -euo pipefail
domain="${DOMAIN:-${domain:-}}"
if [ -z "$domain" ]; then
  # Every Linode resolves as <ip-with-dashes>.ip.linodeusercontent.com, enough for a Let's Encrypt certificate.
  ip="$(hostname -I | awk '{print $1}')"
  domain="${ip//./-}.ip.linodeusercontent.com"
fi
curl -fsSL https://raw.githubusercontent.com/dharmeshgurnani/CodeOtter/main/install.sh \
  | CODEOTTER_DOMAIN="$domain" GH_TOKEN="${GH_TOKEN:-${gh_token:-}}" LLM_API_KEY="${LLM_API_KEY:-${llm_api_key:-}}" bash
