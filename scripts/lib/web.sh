# shellcheck shell=bash
# Web build helpers shared by check.sh and deploy.sh. Source after config.sh + use_env.

# Run a command inside web/.
web() { (cd "$ROOT/web" && "$@"); }

# npm ci when node_modules is missing or older than the lockfile.
npm_ci_if_stale() {
  if [[ ! -f "$ROOT/web/node_modules/.package-lock.json" ||
    "$ROOT/web/package-lock.json" -nt "$ROOT/web/node_modules/.package-lock.json" ]]; then
    web npm ci --no-audit --no-fund
  fi
}

# Fail early, with the fix, if Playwright's full Chromium (not the headless shell) is missing.
require_chromium() {
  local exe
  exe="$(web node -e "console.log(require('@playwright/test').chromium.executablePath())")"
  if [[ ! -x "$exe" ]]; then
    echo "Playwright Chromium not found at $exe." >&2
    echo "Install it: (cd web && npx playwright install --no-shell chromium)" >&2
    return 1
  fi
}

# Run the Playwright smoke tests against a built dist served at a base.
smoke() {
  local base="$1" dist="$2"
  web env BASE="$base" DIST_DIR="$dist" npx --no-install playwright test
}

# Build web/ for a base into a dist directory (relative to web/), then verify that build.
# check.sh calls it for staging; deploy.sh --production calls it for production.
build_and_verify() {
  local base="$1" dist="$2"
  echo "build: BASE=$base -> web/$dist"
  web env BASE="$base" npx --no-install vite build --outDir "$dist" --emptyOutDir
  smoke "$base" "$dist"
}
