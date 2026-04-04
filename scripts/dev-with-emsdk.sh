#!/usr/bin/env bash
# Source sibling ../emsdk (or EMSDK_ENV), then start Vite from the Oracle repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ORACLE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
DEFAULT_EMSDK_ENV="$ORACLE_ROOT/../emsdk/emsdk_env.sh"
EMSDK_ENV="${EMSDK_ENV:-$DEFAULT_EMSDK_ENV}"

if [ ! -f "$EMSDK_ENV" ]; then
  echo "dev-with-emsdk: emsdk_env.sh not found." >&2
  echo "  Expected: $EMSDK_ENV" >&2
  echo "  Install emsdk next to Oracle (../emsdk) or set EMSDK_ENV to emsdk_env.sh." >&2
  exit 1
fi

# shellcheck disable=SC1090
source "$EMSDK_ENV"

cd "$ORACLE_ROOT"
echo "[Oracle] repo: $ORACLE_ROOT" >&2
echo "[Oracle] emcmake: $(command -v emcmake 2>/dev/null || echo 'not found — run npm run build:wasm in this shell after fixing PATH')" >&2
exec npm run dev
