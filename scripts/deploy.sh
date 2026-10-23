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

usage() {
  sed -n '2,10p' "$ROOT/scripts/deploy.sh" | sed 's/^# \{0,1\}//'
  exit 2
}

url_for() { [[ "$1" == production ]] && echo "$URL_PRODUCTION" || echo "$URL_STAGING"; }
base_for() { [[ "$1" == production ]] && echo "$BASE_PRODUCTION" || echo "$BASE_STAGING"; }
unit_for() { [[ "$1" == production ]] && echo "$UNIT_PRODUCTION" || echo "$UNIT_STAGING"; }
dist_for() { [[ "$1" == production ]] && echo "dist-production" || echo "dist"; }

# Copy a checked build and a commit's server code into place, and record what is there.
# Refuses unless HEAD is still that commit and the tree is clean.
publish() {
  local target="$1" commit="$2" dir previous
  require_unchanged "$commit"
  dir="$(target_dir "$target")"
  check_dist "$ROOT/web/$(dist_for "$target")"
  previous="$(marker "$dir" DEPLOYED_COMMIT)"
  mkdir -p "$dir"
  # Until DEPLOYED_COMMIT is rewritten at the end, the folder vouches for nothing.
  clear_verified "$dir"
  rm -f "$dir/DEPLOYED_COMMIT"
  echo "== publishing server/ at $commit to $dir/server"
  ship_server "$dir/server" "$commit"
  if server_changed "$previous" "$commit"; then
    date +%s > "$dir/SERVER_DEPLOYED_AT"
  fi
  echo "== publishing web/$(dist_for "$target") to $dir/web"
  rsync_web "$ROOT/web/$(dist_for "$target")" "$dir/web"
  echo "$commit" > "$dir/DEPLOYED_COMMIT"
}

# The live checks; on success, mark the deployed commit as verified. They run this
# checkout's tests, so HEAD must be the deployed commit and the tree clean.
verify() {
  local target="$1" dir url unit deployed response code body
  dir="$(target_dir "$target")"
  require_clean_tree
  require_deployed_head "$dir"
  deployed="$(marker "$dir" DEPLOYED_COMMIT)"
  url="$(url_for "$target")"
  unit="$(unit_for "$target")"

  echo "== probing ${url}api/health"
  # The body, then the status code on its own last line.
  response="$(curl -s -w '\n%{http_code}' --max-time 20 "${url}api/health" || true)"
  code="${response##*$'\n'}"
  body="${response%$'\n'*}"
  if ! probe_advice "$code" "$body" "$unit" "$target" >&2; then
    exit 3
  fi
  if restart_pending "$dir" "$unit"; then
    echo "The server code changed, but $unit is still running the old copy. Run" >&2
    echo "  sudo systemctl restart $unit" >&2
    echo "then, once 'systemctl is-active $unit' says active:" >&2
    echo "  scripts/deploy.sh --smoke-only $target" >&2
    exit 3
  fi

  echo "== checking live headers, types and API"
  python "$ROOT/scripts/check_live.py" "$url" "$dir/web"
  echo "== running the smoke tests against $url"
  web env BASE="$(base_for "$target")" SMOKE_URL="$url" npx --no-install playwright test
  require_unchanged "$deployed"
  mark_verified "$dir" "$deployed"
  echo "== $target verified at $deployed"
}

deploy_staging() {
  require_clean_tree
  use_env
  local head
  head="$(head_commit)"
  # check.sh builds and tests web/dist for staging; publish exactly that build.
  "$ROOT/scripts/check.sh"
  publish staging "$head"
  verify staging
}

deploy_production() {
  local head
  head="$(head_commit)"
  if ! staging_verified "$(target_dir staging)" "$head"; then
    echo "Refusing: HEAD ($head) is not the commit verified on staging." >&2
    echo "Deploy it to staging first: scripts/deploy.sh staging" >&2
    exit 1
  fi
  require_clean_tree
  use_env
  npm_ci_if_stale
  require_chromium
  # The base path is part of the build, so production is rebuilt from the same commit and
  # goes through the same guards and offline smoke tests before anything is copied.
  build_and_verify "$BASE_PRODUCTION" dist-production
  publish production "$head"
  verify production
}

smoke_only() {
  local target="$1" dir
  dir="$(target_dir "$target")"
  # Cheap preconditions first: the live checks can only vouch for the deployed commit.
  require_clean_tree
  require_deployed_head "$dir"
  use_env
  npm_ci_if_stale
  require_chromium
  verify "$target"
}

main() {
  case "${1:-}" in
    staging) deploy_staging ;;
    --production) deploy_production ;;
    --smoke-only)
      [[ $# -eq 2 ]] || usage
      smoke_only "$2"
      ;;
    *) usage ;;
  esac
}

# Sourcing this file (as the tests do) defines the functions without running anything.
if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
