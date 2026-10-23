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

require_clean_tree() {
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "The working tree has uncommitted changes; deploy only committed, checked code." >&2
    git status --short >&2
    exit 1
  fi
}

url_for() { [[ "$1" == production ]] && echo "$URL_PRODUCTION" || echo "$URL_STAGING"; }
base_for() { [[ "$1" == production ]] && echo "$BASE_PRODUCTION" || echo "$BASE_STAGING"; }
unit_for() { [[ "$1" == production ]] && echo "$UNIT_PRODUCTION" || echo "$UNIT_STAGING"; }
dist_for() { [[ "$1" == production ]] && echo "dist-production" || echo "dist"; }

# Copy a checked build and the committed server code into place, and record what is there.
publish() {
  local target="$1" dir commit previous=""
  dir="$(target_dir "$target")"
  commit="$(git rev-parse HEAD)"
  check_dist "web/$(dist_for "$target")"
  [[ -f "$dir/DEPLOYED_COMMIT" ]] && previous="$(cat "$dir/DEPLOYED_COMMIT")"
  mkdir -p "$dir"
  rm -f "$dir/VERIFIED_COMMIT"
  if [[ "$target" == production && -d "$dir/web" ]]; then
    echo "== keeping the previous production build in $dir/web.prev"
    rsync -a --delete "$dir/web/" "$dir/web.prev/"
  fi
  echo "== publishing web/$(dist_for "$target") to $dir/web"
  rsync_web "web/$(dist_for "$target")" "$dir/web"
  echo "== publishing server/ at $commit to $dir/server"
  ship_server "$dir/server"
  if server_changed "$previous"; then
    date +%s > "$dir/SERVER_DEPLOYED_AT"
  fi
  echo "$commit" > "$dir/DEPLOYED_COMMIT"
}

# The live checks; on success, mark the deployed commit as verified.
verify() {
  local target="$1" dir url base unit
  dir="$(target_dir "$target")"
  url="$(url_for "$target")"
  base="$(base_for "$target")"
  unit="$(unit_for "$target")"
  [[ -f "$dir/DEPLOYED_COMMIT" ]] || { echo "nothing deployed to $target yet" >&2; exit 1; }

  echo "== probing ${url}api/health"
  local code
  code="$(curl -s -o /dev/null -w '%{http_code}' --max-time 20 "${url}api/health" || true)"
  if [[ "$code" != 200 ]]; then
    echo "The $target API is not reachable through Apache (HTTP $code)." >&2
    echo "If this is the first deploy, apply docs/server-setup.md, then run:" >&2
    echo "  scripts/deploy.sh --smoke-only $target" >&2
    exit 3
  fi
  if [[ -f "$dir/SERVER_DEPLOYED_AT" ]] && ! started_since "$unit" "$(cat "$dir/SERVER_DEPLOYED_AT")"; then
    echo "The server code changed, but $unit is still running the old copy. Run:" >&2
    echo "  sudo systemctl restart $unit && scripts/deploy.sh --smoke-only $target" >&2
    exit 3
  fi

  echo "== checking live headers, types and API"
  python scripts/check_live.py "$url" "$dir/web"
  echo "== running the smoke tests against $url"
  web env BASE="$base" SMOKE_URL="$url" npx --no-install playwright test
  cp "$dir/DEPLOYED_COMMIT" "$dir/VERIFIED_COMMIT"
  rm -f "$dir/SERVER_DEPLOYED_AT"
  echo "== $target verified at $(cat "$dir/VERIFIED_COMMIT")"
}

deploy_staging() {
  require_clean_tree
  use_env
  local head
  head="$(git rev-parse HEAD)"
  scripts/check.sh
  # check.sh built and tested web/dist for staging; publish exactly that.
  require_clean_tree
  [[ "$(git rev-parse HEAD)" == "$head" ]] || { echo "HEAD moved during the check" >&2; exit 1; }
  publish staging
  verify staging
}

deploy_production() {
  require_clean_tree
  local head staging_dir verified=""
  head="$(git rev-parse HEAD)"
  staging_dir="$(target_dir staging)"
  [[ -f "$staging_dir/VERIFIED_COMMIT" ]] && verified="$(cat "$staging_dir/VERIFIED_COMMIT")"
  if [[ "$verified" != "$head" ]]; then
    echo "Refusing: HEAD ($head) is not the commit verified on staging (${verified:-none})." >&2
    echo "Deploy it to staging first: scripts/deploy.sh staging" >&2
    exit 1
  fi
  use_env
  npm_ci_if_stale
  require_chromium
  # The base path is part of the build, so production is rebuilt from the same commit and
  # goes through the same guards and offline smoke tests before anything is copied.
  build_and_verify "$BASE_PRODUCTION" dist-production
  publish production
  verify production
}

case "${1:-}" in
  staging) deploy_staging ;;
  --production) deploy_production ;;
  --smoke-only)
    [[ $# -eq 2 ]] || usage
    use_env
    npm_ci_if_stale
    require_chromium
    verify "$2"
    ;;
  *) usage ;;
esac
