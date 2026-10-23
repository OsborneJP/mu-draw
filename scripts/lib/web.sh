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

# Build web/ for a base into a dist directory (relative to web/), then verify that build.
# check.sh calls it for staging; deploy.sh --production calls it for production.
build_and_verify() {
  local base="$1" dist="$2"
  echo "build: BASE=$base -> web/$dist"
  web env BASE="$base" npx --no-install vite build --outDir "$dist" --emptyOutDir
}
