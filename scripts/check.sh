#!/usr/bin/env bash
# The one gate. Run it before every commit and every deploy:
#   scripts/check.sh
# It stops at the first failure and prints CHECK PASSED only when every stage
# passed. The full log is also written to .check.log.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/config.sh"
source "$ROOT/scripts/lib/web.sh"
source "$ROOT/scripts/lib/tree.sh"
cd "$ROOT"
exec > >(tee "$ROOT/.check.log") 2>&1

CURRENT_STAGE="preflight"
trap 'status=$?; if (( status != 0 )); then echo; echo "CHECK FAILED at stage: $CURRENT_STAGE"; fi' EXIT

stage() {
  CURRENT_STAGE="$1"
  shift
  local started=$SECONDS
  printf '\n== %s\n' "$CURRENT_STAGE"
  "$@"
  printf -- '-- %s ok (%ds)\n' "$CURRENT_STAGE" $((SECONDS - started))
}

checks() { PYTHONPATH="$ROOT/scripts" python -m "checks.$1" "$ROOT"; }

use_env
npm_ci_if_stale
require_chromium
# The check must leave the tree as it found it (no fixtures regenerated in
# place, no stray files outside .gitignore), compared by content.
STATUS_BEFORE="$(git status --porcelain)"
TREE_BEFORE="$(tree_fingerprint)"

stage "placeholder literals" checks placeholders
stage "chemistry literals" checks chem_literals
stage "AGENTS.md" checks agents_md
stage "ruff" bash -c 'ruff check . && ruff format --check .'
stage "pytest" python -m pytest -q
stage "tsc" web npx --no-install tsc -b
stage "eslint" web npx --no-install eslint . --max-warnings 0
stage "vitest" web npx --no-install vitest run
stage "build + verify (staging)" build_and_verify "$BASE_STAGING" dist

CURRENT_STAGE="tree unchanged"
if [[ "$(tree_fingerprint)" != "$TREE_BEFORE" ]]; then
  echo "check.sh changed the working tree (a file was created, deleted or rewritten):"
  diff <(echo "$STATUS_BEFORE") <(git status --porcelain) || true
  exit 1
fi

echo
echo "CHECK PASSED"
