# shellcheck shell=bash
# Deploy helpers, sourced by scripts/deploy.sh (and by tests/test_deploy_lib.py).
# Needs config.sh's variables (ROOT, APP_NAME, DEPLOY_ROOT, ...). Never uses sudo.
# Every decision deploy.sh makes lives here as a small function with a test.

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

# Deploy only committed code: no modified, staged or untracked files.
require_clean_tree() {
  local status
  status="$(git -C "$ROOT" status --porcelain)"
  if [[ -n "$status" ]]; then
    echo "The working tree has uncommitted changes; deploy only committed, checked code:" >&2
    echo "$status" >&2
    return 1
  fi
}

# The commit recorded in a marker file in a target folder, or nothing.
marker() { [[ -f "$1/$2" ]] && cat "$1/$2" || true; }

# The live checks run this checkout's tests, so they may only vouch for a target when
# HEAD is the commit deployed there.
require_deployed_head() {
  local dir="$1" deployed head
  deployed="$(marker "$dir" DEPLOYED_COMMIT)"
  head="$(git -C "$ROOT" rev-parse HEAD)"
  if [[ -z "$deployed" ]]; then
    echo "nothing deployed in $dir yet" >&2
    return 1
  fi
  if [[ "$deployed" != "$head" ]]; then
    echo "$dir runs $deployed but HEAD is $head." >&2
    echo "Check out the deployed commit (or deploy HEAD) before running the live checks." >&2
    return 1
  fi
}

# The production gate: only the commit that passed the live checks on staging.
staging_verified() {
  local staging_dir="$1" commit="$2"
  [[ -n "$commit" && "$(marker "$staging_dir" VERIFIED_COMMIT)" == "$commit" ]]
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

# Keep the live production build as web.prev, but only if it passed the live checks, so a
# failed promotion can't overwrite the last good copy.
snapshot_web() {
  local dir="$1" verified
  verified="$(marker "$dir" VERIFIED_COMMIT)"
  [[ -d "$dir/web" && -n "$verified" && "$verified" == "$(marker "$dir" DEPLOYED_COMMIT)" ]] || return 0
  rsync -a --delete "$dir/web/" "$dir/web.prev/"
  echo "$verified" > "$dir/WEB_PREV_COMMIT"
}

# Ship a commit's server code (not the working tree), without its tests and scripts. It
# must import with the env's Python before it replaces the deployed copy.
ship_server() {
  local dest="$1" commit="$2" tmp status=0
  tmp="$(mktemp -d)"
  if git -C "$ROOT" archive "$commit" server | tar -x -C "$tmp" &&
    rm -rf "$tmp/server/tests" "$tmp/server/scripts" &&
    (cd "$tmp/server" && PYTHONDONTWRITEBYTECODE=1 python -c 'import main'); then
    mkdir -p "$dest"
    rsync "${RSYNC_OPTS[@]}" --delete "$tmp/server/" "$dest/" || status=$?
  else
    echo "server code at $commit doesn't import; the deployed copy was left alone" >&2
    status=1
  fi
  rm -rf "$tmp"
  return "$status"
}

# True if the server's code or environment changed between a deployed commit and another
# (or if nothing was deployed before).
server_changed() {
  local previous="$1" commit="${2:-HEAD}"
  [[ -z "$previous" ]] && return 0
  ! git -C "$ROOT" diff --quiet "$previous" "$commit" -- server environment.yml environment.lock.txt 2>/dev/null
}

# True if a systemd unit is active and was started at or after an epoch time.
started_since() {
  local unit="$1" since="$2" started
  started="$(systemctl show -p ActiveEnterTimestamp --value "$unit" 2>/dev/null || true)"
  [[ -n "$started" && "$started" != "n/a" ]] || return 1
  [[ "$(systemctl is-active "$unit" 2>/dev/null || true)" == "active" ]] || return 1
  (($(date -d "$started" +%s) >= since))
}

# True if server code was deployed after the unit last started (so it runs the old copy).
restart_pending() {
  local dir="$1" unit="$2"
  [[ -f "$dir/SERVER_DEPLOYED_AT" ]] && ! started_since "$unit" "$(cat "$dir/SERVER_DEPLOYED_AT")"
}

# A target is verified only after its live checks pass; publishing clears the mark first.
clear_verified() { rm -f "$1/VERIFIED_COMMIT"; }
mark_verified() {
  cp "$1/DEPLOYED_COMMIT" "$1/VERIFIED_COMMIT"
  rm -f "$1/SERVER_DEPLOYED_AT"
}
