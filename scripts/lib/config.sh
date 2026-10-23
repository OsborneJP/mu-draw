# shellcheck shell=bash
# Sourced by check.sh and deploy.sh. Exports the values derived from
# app.config.json (see scripts/lib/appconfig.py) and puts the project's conda
# env first on PATH, so `node`, `npm`, `python` and `uvicorn` all come from it.
# Never `conda activate` here: it is a shell function that scripts don't have,
# and some activate.d hooks break under `set -u`.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
export ROOT

# stdlib-only Python; any python3 will do before the env is on PATH.
eval "$(python3 -I "$ROOT/scripts/lib/appconfig.py" --shell)"
export APP_NAME APP_PATH STAGING_PATH BASE_PRODUCTION BASE_STAGING APP_HOST URL_PRODUCTION \
  URL_STAGING ENV_NAME DEPLOY_ROOT PORT_PRODUCTION PORT_STAGING PORT_DEV UNIT_PRODUCTION UNIT_STAGING

# Version of a package as pinned in environment.lock.txt.
locked_version() {
  sed -nE "s#^.*/$1-([0-9][0-9.]*)-[^/]*\$#\\1#p" "$ROOT/environment.lock.txt"
}

use_env() {
  local conda_bin="${CONDA_EXE:-$HOME/anaconda3/bin/conda}"
  ENV_PREFIX="$("$conda_bin" info --base)/envs/$ENV_NAME"
  export ENV_PREFIX
  if [[ ! -x "$ENV_PREFIX/bin/python" ]]; then
    echo "conda env '$ENV_NAME' not found at $ENV_PREFIX." >&2
    echo "Create it: conda env create -n $ENV_NAME -f environment.yml" >&2
    return 1
  fi
  export PATH="$ENV_PREFIX/bin:$PATH"

  local want_node want_rdkit have_node have_prefix have_rdkit
  want_node="$(locked_version nodejs)"
  want_rdkit="$(locked_version rdkit)"
  have_node="$(node -v)"
  have_prefix="$(python -I -c 'import sys; print(sys.prefix)')"
  have_rdkit="$(python -I -c 'import rdkit; print(rdkit.__version__)')"
  if [[ "$have_node" != "v$want_node" || "$have_prefix" != "$ENV_PREFIX" || "$have_rdkit" != "$want_rdkit" ]]; then
    echo "Toolchain mismatch: node $have_node (want v$want_node), python $have_prefix" >&2
    echo "(want $ENV_PREFIX), rdkit $have_rdkit (want $want_rdkit)." >&2
    echo "Update the env: conda env update -n $ENV_NAME -f environment.yml --prune" >&2
    return 1
  fi
  echo "toolchain: node $have_node, rdkit $have_rdkit, env $ENV_PREFIX"
}
