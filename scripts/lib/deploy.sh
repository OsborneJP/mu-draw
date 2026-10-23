# shellcheck shell=bash
# Deploy helpers, sourced by scripts/deploy.sh (and by tests/test_deploy_lib.py).
# Needs config.sh's variables (ROOT, APP_NAME, DEPLOY_ROOT, ...). Never uses sudo.
# The decisions live here as small functions with tests; tests/test_deploy_lib.py also
# runs deploy.sh's mode functions with stubs to check they call them.

# --checksum: compare content, not size+mtime. git archive stamps files with the commit
# time, so two versions of a file with the same length committed in the same second
# would otherwise look unchanged and the old one would stay (a test caught this).
RSYNC_OPTS=(-a --checksum --chmod=D755,F644 --out-format=%n)

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

head_commit() { git -C "$ROOT" rev-parse HEAD; }

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

# The tree is still clean and HEAD is still the commit a run started with (a build or a
# check can take minutes; nothing else may land in the meantime).
require_unchanged() {
  local commit="$1"
  require_clean_tree
  if [[ "$(head_commit)" != "$commit" ]]; then
    echo "HEAD moved during the deploy (was $commit); start again" >&2
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
  head="$(head_commit)"
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
  echo "-- phase 1: everything but the entry files"
  rsync "${RSYNC_OPTS[@]}" --exclude=/index.html --exclude=/manifest.webmanifest \
    --exclude=/sw.js "$src/" "$dest/"
  echo "-- phase 2: manifest"
  rsync "${RSYNC_OPTS[@]}" "$src/manifest.webmanifest" "$dest/"
  echo "-- phase 3: index.html"
  rsync "${RSYNC_OPTS[@]}" "$src/index.html" "$dest/"
  echo "-- phase 4: sw.js"
  rsync "${RSYNC_OPTS[@]}" "$src/sw.js" "$dest/"
  echo "-- phase 5: delete what the new build doesn't have"
  rsync "${RSYNC_OPTS[@]}" --delete "$src/" "$dest/"
}

# Ship a commit's server code (not the working tree), without its tests and scripts. It
# must import with the env's Python before it replaces the deployed copy.
ship_server() {
  local dest="$1" commit="$2" tmp status=0
  tmp="$(mktemp -d)"
  if git -C "$ROOT" archive "$commit" server | tar -x -C "$tmp" &&
    rm -rf "$tmp/server/tests" "$tmp/server/scripts" &&
    (cd "$tmp/server" && PYTHONDONTWRITEBYTECODE=1 python -c 'import main'); then
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
  local previous="$1" commit="$2"
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

# What to tell the person when the API health probe through Apache doesn't answer
# {"ok": true}. Returns 0 (nothing to say) when it does.
probe_advice() {
  local code="$1" body="$2" unit="$3" target="$4"
  if [[ "$code" == 200 && "$(tr -d ' \n' <<< "$body")" == '{"ok":true}' ]]; then
    return 0
  fi
  case "$code" in
    404) echo "Apache doesn't know the $target path yet (HTTP 404): apply docs/server-setup.md." ;;
    403) echo "Apache refused this host (HTTP 403): its own address must be inside 10.0.0.0/8." ;;
    502 | 503) echo "Apache can't reach the API (HTTP $code): check 'systemctl status $unit'." ;;
    200) echo "Something answered with HTTP 200 but not {\"ok\": true}: check the Apache block." ;;
    *) echo "The $target API probe failed (HTTP ${code:-none})." ;;
  esac
  echo "Then run: scripts/deploy.sh --smoke-only $target"
  return 1
}

# A target is verified only after its live checks pass; publishing clears the mark first.
clear_verified() { rm -f "$1/VERIFIED_COMMIT"; }

# Mark a commit verified, but only if it is still the one deployed there (a deploy that
# ran meanwhile must not inherit this run's result).
mark_verified() {
  local dir="$1" commit="$2"
  if [[ "$(marker "$dir" DEPLOYED_COMMIT)" != "$commit" ]]; then
    echo "$dir changed during the live checks; not marking $commit verified" >&2
    return 1
  fi
  echo "$commit" > "$dir/VERIFIED_COMMIT"
  rm -f "$dir/SERVER_DEPLOYED_AT"
}
