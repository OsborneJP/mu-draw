#!/usr/bin/env bash
# The one gate. Run it before every commit and every deploy:
#   scripts/check.sh
# It stops at the first failure and prints CHECK PASSED only when every stage
# passed. The full log is also written to .check.log.
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/lib/config.sh"
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
# The check must leave the tree as it found it (no fixtures regenerated in
# place, no stray files outside .gitignore).
STATUS_BEFORE="$(git status --porcelain)"

stage "placeholder literals" checks placeholders
stage "chemistry literals" checks chem_literals
stage "AGENTS.md" checks agents_md
stage "ruff" bash -c 'ruff check . && ruff format --check .'
stage "pytest" python -m pytest -q

CURRENT_STAGE="tree unchanged"
if [[ "$(git status --porcelain)" != "$STATUS_BEFORE" ]]; then
  echo "check.sh changed the working tree:"
  diff <(echo "$STATUS_BEFORE") <(git status --porcelain) || true
  exit 1
fi

echo
echo "CHECK PASSED"
