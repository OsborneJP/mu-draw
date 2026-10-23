# shellcheck shell=bash
# Deploy helpers, sourced by scripts/deploy.sh (and by tests/test_deploy_lib.py).
# Needs config.sh's variables (ROOT, APP_NAME, DEPLOY_ROOT, ...). Never uses sudo.

RSYNC_OPTS=(-a --chmod=D755,F644 --out-format=%n)

# The deploy folder for a target, after checking it is exactly $HOME/srv/<name>/<target>.
# A bad config must never point rsync --delete somewhere else.
target_dir() {
  local target="$1"
  case "$target" in
    staging | production) ;;
    *)
      echo "unknown target '$target' (staging or production)" >&2
      return 1
      ;;
  esac
  if [[ -z "${APP_NAME:-}" || "$DEPLOY_ROOT" != "$HOME/srv/$APP_NAME" ]]; then
    echo "refusing to deploy: DEPLOY_ROOT '$DEPLOY_ROOT' is not \$HOME/srv/<name>" >&2
    return 1
  fi
  echo "$DEPLOY_ROOT/$target"
}

# A built dist that is safe to publish: the entry files exist; no maps or dotfiles.
check_dist() {
  local dist="$1" missing=0 file
  for file in index.html sw.js manifest.webmanifest; do
    if [[ ! -f "$dist/$file" ]]; then
      echo "dist is missing $file: $dist" >&2
      missing=1
    fi
  done
  if [[ -n "$(find "$dist" \( -name '*.map' -o -name '.*' \) -print -quit)" ]]; then
    echo "dist contains source maps or dotfiles: $dist" >&2
    missing=1
  fi
  return "$missing"
}

# Publish a dist in an order that never leaves a client with a service worker whose files
# aren't there yet: everything else first (assets/, workbox-*.js, icons, the RDKit wasm),
# then the manifest, then index.html, then sw.js last; then delete what the new build
# no longer has. Prints each file as it is transferred.
rsync_web() {
  local src="$1" dest="$2"
  mkdir -p "$dest"
  rsync "${RSYNC_OPTS[@]}" --exclude=/index.html --exclude=/manifest.webmanifest \
    --exclude=/sw.js "$src/" "$dest/"
  rsync "${RSYNC_OPTS[@]}" "$src/manifest.webmanifest" "$dest/"
  rsync "${RSYNC_OPTS[@]}" "$src/index.html" "$dest/"
  rsync "${RSYNC_OPTS[@]}" "$src/sw.js" "$dest/"
  rsync "${RSYNC_OPTS[@]}" --delete "$src/" "$dest/"
}

# Ship the committed server code (not the working tree), without its tests and scripts,
# then check that it imports with the env's Python.
ship_server() {
  local dest="$1" tmp
  tmp="$(mktemp -d)"
  git -C "$ROOT" archive HEAD server | tar -x -C "$tmp"
  rm -rf "$tmp/server/tests" "$tmp/server/scripts"
  mkdir -p "$dest"
  rsync "${RSYNC_OPTS[@]}" --delete "$tmp/server/" "$dest/"
  rm -rf "$tmp"
  (cd "$dest" && python -c 'import main')
}

# True if the server's code or environment changed between a deployed commit and HEAD
# (or if nothing was deployed before).
server_changed() {
  local previous="$1"
  [[ -z "$previous" ]] && return 0
  ! git -C "$ROOT" diff --quiet "$previous" HEAD -- server environment.yml environment.lock.txt 2>/dev/null
}

# True if a systemd unit is running and was started at or after an epoch time.
started_since() {
  local unit="$1" since="$2" started
  started="$(systemctl show -p ActiveEnterTimestamp --value "$unit" 2>/dev/null || true)"
  [[ -n "$started" && "$started" != "n/a" ]] || return 1
  [[ "$(systemctl is-active "$unit" 2>/dev/null || true)" == "active" ]] || return 1
  (($(date -d "$started" +%s) >= since))
}
