#!/usr/bin/env bash
# Deploy the app to osbornelab (never uses sudo; see docs/server-setup.md).
#
#   scripts/deploy.sh staging                 check, then publish the tested build to staging
#   scripts/deploy.sh --production            promote the commit that passed live on staging
#   scripts/deploy.sh --smoke-only <target>   re-run the live checks only
#
# A target is "verified" only after the live checks pass against it: the API through
# Apache, the cache/type/CSP headers, and the Playwright smoke tests (including offline)
# run against the deployed URL. --production refuses any commit staging hasn't verified.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/config.sh"
source "$ROOT/scripts/lib/web.sh"
source "$ROOT/scripts/lib/deploy.sh"
cd "$ROOT"

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit 2
}

url_for() { [[ "$1" == production ]] && echo "$URL_PRODUCTION" || echo "$URL_STAGING"; }
base_for() { [[ "$1" == production ]] && echo "$BASE_PRODUCTION" || echo "$BASE_STAGING"; }
unit_for() { [[ "$1" == production ]] && echo "$UNIT_PRODUCTION" || echo "$UNIT_STAGING"; }
dist_for() { [[ "$1" == production ]] && echo "dist-production" || echo "dist"; }

# Stop unless the tree is clean and HEAD is still the commit this run started with.
require_unchanged() {
  require_clean_tree
  [[ "$(git rev-parse HEAD)" == "$1" ]] || { echo "HEAD moved during the deploy; start again" >&2; exit 1; }
}

# Copy a checked build and a commit's server code into place, and record what is there.
publish() {
  local target="$1" commit="$2" dir previous
  dir="$(target_dir "$target")"
  check_dist "web/$(dist_for "$target")"
  previous="$(marker "$dir" DEPLOYED_COMMIT)"
  mkdir -p "$dir"
  [[ "$target" == production ]] && snapshot_web "$dir"
  clear_verified "$dir"
  echo "== publishing server/ at $commit to $dir/server"
  ship_server "$dir/server" "$commit"
  if server_changed "$previous" "$commit"; then
    date +%s > "$dir/SERVER_DEPLOYED_AT"
  fi
  echo "== publishing web/$(dist_for "$target") to $dir/web"
  rsync_web "web/$(dist_for "$target")" "$dir/web"
  echo "$commit" > "$dir/DEPLOYED_COMMIT"
}

# The live checks; on success, mark the deployed commit as verified. They run this
# checkout's tests, so HEAD must be the deployed commit and the tree clean.
verify() {
  local target="$1" dir url base unit deployed code
  dir="$(target_dir "$target")"
  url="$(url_for "$target")"
  base="$(base_for "$target")"
  unit="$(unit_for "$target")"
  require_clean_tree
  require_deployed_head "$dir"
  deployed="$(marker "$dir" DEPLOYED_COMMIT)"

  echo "== probing ${url}api/health"
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${url}api/health" || true)"
  if [[ "$code" != 200 ]]; then
    echo "The $target API is not reachable through Apache (HTTP $code)." >&2
    echo "If this is the first deploy, apply docs/server-setup.md, then run:" >&2
    echo "  scripts/deploy.sh --smoke-only $target" >&2
    exit 3
  fi
  if restart_pending "$dir" "$unit"; then
    echo "The server code changed, but $unit is still running the old copy. Run:" >&2
    echo "  sudo systemctl restart $unit && scripts/deploy.sh --smoke-only $target" >&2
    exit 3
  fi

  echo "== checking live headers, types and API"
  python scripts/check_live.py "$url" "$dir/web"
  echo "== running the smoke tests against $url"
  web env BASE="$base" SMOKE_URL="$url" npx --no-install playwright test
  mark_verified "$dir"
  echo "== $target verified at $deployed"
}

deploy_staging() {
  require_clean_tree
  use_env
  local head
  head="$(git rev-parse HEAD)"
  # check.sh builds and tests web/dist for staging; publish exactly that build.
  scripts/check.sh
  require_unchanged "$head"
  publish staging "$head"
  verify staging
}

deploy_production() {
  require_clean_tree
  local head
  head="$(git rev-parse HEAD)"
  if ! staging_verified "$(target_dir staging)" "$head"; then
    echo "Refusing: HEAD ($head) is not the commit verified on staging." >&2
    echo "Deploy it to staging first: scripts/deploy.sh staging" >&2
    exit 1
  fi
  use_env
  npm_ci_if_stale
  require_chromium
  # The base path is part of the build, so production is rebuilt from the same commit and
  # goes through the same guards and offline smoke tests before anything is copied.
  build_and_verify "$BASE_PRODUCTION" dist-production
  require_unchanged "$head"
  publish production "$head"
  verify production
}

case "${1:-}" in
  staging) deploy_staging ;;
  --production) deploy_production ;;
  --smoke-only)
    [[ $# -eq 2 ]] || usage
    target_dir "$2" > /dev/null
    use_env
    npm_ci_if_stale
    require_chromium
    verify "$2"
    ;;
  *) usage ;;
esac
