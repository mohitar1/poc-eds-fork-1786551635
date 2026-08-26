#!/usr/bin/env bash
# Local dev: runs the AEM dev server and the Cloudflare worker as two processes.
set -euo pipefail

AEM_PAGES_URL="${AEM_PAGES_URL:-https://main--acme-portal--acme-co.aem.page}"

npx aem up &
( cd cloudflare && npm run dev ) &
wait
