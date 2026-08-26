#!/bin/bash

# shellcheck disable=SC2164

# Run full local development stack

AEM_PAGES_URL=${AEM_PAGES_URL:-https://main--poc-eds-fork-1786551635--mohitar1.aem.page}
AEM_ENV_ID=${AEM_ENV_ID:-p203220-e2129061}

# https://www.aem.live/developer/cli-reference#general-options
AEM_LOG_LEVEL=${AEM_LOG_LEVEL:-info}

# setting for wrangler dev --log-level
CLOUDFLARE_LOG_LEVEL=${CLOUDFLARE_LOG_LEVEL:-info}

# Skip Microsoft Entra login locally (set to "true" to disable auth)
DISABLE_AUTHENTICATION=${DISABLE_AUTHENTICATION:-false}

export FORCE_COLOR=1
set -e
set -o pipefail

# ANSI colors
RED=$'\033[31m'
BG_BLUE=$'\033[44m'
BG_YELLOW=$'\033[43m'
BG_MAGENTA=$'\033[45m'
# ANSI Reset
NC=$'\033[0m'

if [ ! -d cloudflare/node_modules ]; then
  echo "${RED}Error: cloudflare/node_modules not found. Run 'npm install' first.${NC}" >&2
  exit 1
fi

# aem up requires a git repo with a main branch and an origin remote
function ensure_git_for_aem() {
  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    git init -q
    git checkout -b main 2>/dev/null || true
  fi
  if ! git rev-parse refs/heads/main >/dev/null 2>&1; then
    git checkout -b main 2>/dev/null || true
    git commit --allow-empty -m "chore: init repo for local aem dev" -q 2>/dev/null || true
  fi
  if ! git remote get-url origin >/dev/null 2>&1; then
    git remote add origin https://github.com/aem-showcase/assethub-spark.git
    echo "${BG_MAGENTA}[aem]${NC} Added placeholder git remote 'origin' (required by aem up)"
  fi
}

ensure_git_for_aem

function find_port() {
  local default=$1
  local fallback=${2:-$(( default + 1 ))}
  if ! nc -z localhost "$default" > /dev/null 2>&1; then
    echo "$default"
    return
  fi
  local port=$fallback
  local max=$(( fallback + 20 ))
  while nc -z localhost "$port" > /dev/null 2>&1; do
    port=$(( port + 1 ))
    if [ "$port" -ge "$max" ]; then
      echo "Error: no free port found in range $fallback-$max" >&2
      exit 1
    fi
  done
  echo "$port"
}

if nc -z localhost 3000 > /dev/null 2>&1 \
  || nc -z localhost 8787 > /dev/null 2>&1 \
  || nc -z localhost 9229 > /dev/null 2>&1; then
  echo "${BG_BLUE}[dev]${NC} Finding unused localhost ports..."
fi

# aem-cli overrides --port when it equals the default 3000 in worktrees,
# so use 3001 as the base port to prevent the override.
if [ -f .git ] && grep -q '/worktrees/' .git 2>/dev/null; then
  AEM_PORT=$(find_port 3001)
else
  AEM_PORT=$(find_port 3000)
fi
CF_PORT=$(find_port 8787 9001)
INSPECTOR_PORT=$(find_port 9229 9301)

echo "${BG_MAGENTA}[aem]${NC} AEM Dev server port: ${AEM_PORT}"
echo "${BG_YELLOW}[cfl]${NC} Cloudflare Dev server port: ${CF_PORT} (inspector ${INSPECTOR_PORT})"

function prefix() {
  sed "s/^/${1}${2}$NC /"
}

function read_helix_site_token() {
  local secrets_file="cloudflare/.secrets"
  if [ ! -f "$secrets_file" ]; then
    return
  fi
  # shellcheck disable=SC2002
  grep -m 1 '^SPARK_HELIX_ORIGIN_AUTHENTICATION=' "$secrets_file" \
    | sed -E 's/^[^=]+="?([^"]*)"?/\1/'
}

function run_aem() {
  local helix_site_token
  helix_site_token="$(read_helix_site_token)"
  local site_token_args=()
  if [ -n "$helix_site_token" ]; then
    site_token_args=(--site-token "$helix_site_token")
    echo "${BG_MAGENTA}[aem]${NC} Using Helix site token from cloudflare/.secrets"
  else
    echo "${BG_MAGENTA}[aem]${NC} No Helix site token in cloudflare/.secrets — aem up may prompt for Helix login"
  fi

  # add "--log-level silly" if full aem logs are needed
  npx aem up --no-open --livereload --port "${AEM_PORT}" \
    --log-level "${AEM_LOG_LEVEL}" --url "${AEM_PAGES_URL}" \
    "${site_token_args[@]}"
}

function filter_cf_logs() {
  if [ "$CLOUDFLARE_REQUEST_LOGS" != "1" ]; then
    grep --line-buffered -v -E "^.*\[wrangler:info\].*(GET|HEAD|POST|OPTIONS|PUT|DELETE|TRACE|CONNECT)"
  else
    cat
  fi
}

function run_cloudflare() {
  # Symlink .secrets from main checkout if running in a worktree
  SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
  if [[ "$SCRIPT_DIR" == */.worktrees/* ]] && [ ! -e cloudflare/.secrets ]; then
    MAIN_SECRETS="${SCRIPT_DIR}/../../cloudflare/.secrets"
    if [ -f "$MAIN_SECRETS" ]; then
      ln -sf "$MAIN_SECRETS" cloudflare/.secrets
    fi
  fi

  cd cloudflare

  # add "--live-reload" if auto-reload on cloudflare changes is needed
  npm run dev -- \
    --env branch \
    --port "${CF_PORT}" \
    --var "HELIX_ORIGIN:http://localhost:${AEM_PORT}" \
    --var "AEM_ENV_ID:${AEM_ENV_ID}" \
    --var "DISABLE_AUTHENTICATION:${DISABLE_AUTHENTICATION}" \
    --log-level="${CLOUDFLARE_LOG_LEVEL}" \
    --inspector-port "${INSPECTOR_PORT}" \
    2>&1 | filter_cf_logs
}

# aem: http://localhost:${AEM_PORT}
(run_aem 2>&1 | prefix $BG_MAGENTA "[aem]") &

sleep 1
echo

# cloudflare worker: http://localhost:${CF_PORT}
(run_cloudflare 2>&1 | prefix $BG_YELLOW "[cfl]" ) &

AEM_WAIT=0
while ! nc -z "localhost" "${AEM_PORT}" > /dev/null 2>&1; do
  AEM_WAIT=$(( AEM_WAIT + 1 ))
  if [ "$AEM_WAIT" -ge 60 ]; then
    echo "${RED}[aem] Error: AEM dev server did not start on port ${AEM_PORT} within 60s.${NC}" >&2
    echo "${RED}       Check [aem] logs above for errors (git remote, missing deps, etc.).${NC}" >&2
    exit 1
  fi
  sleep 1
done
echo "${BG_MAGENTA}[aem]${NC} AEM dev server ready on http://localhost:${AEM_PORT}"

while ! nc -z "localhost" "${CF_PORT}" > /dev/null 2>&1; do
  sleep 1
done

open -a "${DEV_BROWSER:-Google Chrome}" "http://localhost:${CF_PORT}"

sleep 1

echo
echo "${BG_MAGENTA}[aem]$NC AEM_LOG_LEVEL            = ${AEM_LOG_LEVEL}"
echo "${BG_YELLOW}[cfl]$NC CLOUDFLARE_LOG_LEVEL     = ${CLOUDFLARE_LOG_LEVEL}"
echo "${BG_YELLOW}[cfl]$NC CLOUDFLARE_REQUEST_LOGS  = ${CLOUDFLARE_REQUEST_LOGS}"
echo "${BG_YELLOW}[cfl]$NC DISABLE_AUTHENTICATION   = ${DISABLE_AUTHENTICATION} (Microsoft Entra login)"
if [ "${DISABLE_AUTHENTICATION}" = "true" ]; then
  echo "${BG_BLUE}[dev]$NC Note: Helix content login is separate. If you see an Adobe/Helix login,"
  echo "${BG_BLUE}[dev]$NC       complete it once OR add a fresh SPARK_HELIX_ORIGIN_AUTHENTICATION to cloudflare/.secrets."
fi
echo
echo "${BG_BLUE}[dev]$NC EDS site origin (AEM_PAGES_URL) : ${AEM_PAGES_URL}"
echo "${BG_BLUE}[dev]$NC DM/AEM environment (AEM_ENV_ID) : ${AEM_ENV_ID}"
echo "${BG_BLUE}[dev]$NC"
echo "${BG_BLUE}[dev]$NC Ready on http://localhost:${CF_PORT}"

if [ -f .hlx/.hlx-token ]; then
  echo "${RED}Warning: Unexpected site token found in 'hlx/.hlx-token'. From a login with 'aem up'.${NC}"
  echo "${RED}         If you are getting unexpected 401 errors from EDS, remove this file.${NC}"
fi

wait
