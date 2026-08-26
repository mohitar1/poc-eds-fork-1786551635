#!/bin/bash

# Workaround to make working with Cloudflare Secret Store easier locally
# Takes all secrets from .secrets file and creates a clean local wrangler secret store
# Used before `wrangler dev` for a worker accessing the Secret Store

# Format of .secrets file:
#
#   # comment
#   ONE="top-secret"
#   TWO="super-secret"

set -e
set -o pipefail

FILE=".secrets"

# parse SECRET_STORE_ID out of wrangler.jsonc (strip // comments, read first secret's store_id)
SECRET_STORE_ID=$(node -e "const fs=require('fs');const raw=fs.readFileSync('wrangler.jsonc','utf8').replace(/^\s*\/\/.*$/gm,'');const c=JSON.parse(raw);const s=c.env.production.secrets_store_secrets[0];process.stdout.write(s?s.store_id:'')")

if [ -z "$SECRET_STORE_ID" ]; then
  echo "Error: no secret store_id found in cloudflare/wrangler.jsonc"
  exit 1
fi

if [ ! -f $FILE ]; then
  echo "Error: missing cloudflare/$FILE file"
  exit 1
fi

# check if .secrets file is newer than .wrangler/state/v3/secrets-store
if [ "$FILE" -nt ".wrangler/state/v3/secrets-store" ]; then
  # Load secrets from .secrets file
  echo "Loading secrets from cloudflare/$FILE into local wrangler secret store..."
else
  echo "Local secret store is up to date with cloudflare/$FILE."
  exit 0
fi

# Clean local secret store
rm -rf .wrangler/state/v3/secrets-store

while IFS='=' read -r key value; do
  # Skip empty lines and comments
  if [[ -z "$key" || "$key" =~ ^# ]]; then
      continue
  fi

  # Trim leading/trailing whitespace from key
  key="${key#"${key%%[![:space:]]*}"}"
  key="${key%"${key##*[![:space:]]}"}"

  # Strip surrounding quotes from value and trim whitespace
  # First trim whitespace
  value="${value#"${value%%[![:space:]]*}"}"
  value="${value%"${value##*[![:space:]]}"}"
  # Then strip surrounding double quotes if present
  if [[ "$value" =~ ^\"(.*)\"$ ]]; then
    value="${BASH_REMATCH[1]}"
  fi

  # 'secret create' does create OR update
  # Use printf to avoid shell interpretation of special characters like ~
  printf '%s' "$value" | WRANGLER_LOG=error npx wrangler secrets-store secret create $SECRET_STORE_ID --scopes workers --name "$key" > /dev/null

done < "$FILE"

# for debugging: list all secrets (but wrangler dev will show secret store bindings as well)
# npx wrangler secrets-store secret list $SECRET_STORE_ID

