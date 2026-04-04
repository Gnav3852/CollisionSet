#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$ROOT/native/build" "$ROOT/public/wasm"
cd "$ROOT/native/build"
if ! command -v emcmake >/dev/null 2>&1; then
  echo "Emscripten not found (emcmake). Install https://emscripten.org and run:" >&2
  echo "  source /path/to/emsdk/emsdk_env.sh" >&2
  exit 1
fi
cmake_args=(-DCMAKE_BUILD_TYPE=Release)
if [ "${ORACLE_ZENO_DEBUG:-}" = "1" ] || [ "${ORACLE_ZENO_DEBUG:-}" = "ON" ]; then
  cmake_args+=(-DORACLE_ZENO_DEBUG=ON)
fi
emcmake cmake .. "${cmake_args[@]}"
cmake --build . --parallel
