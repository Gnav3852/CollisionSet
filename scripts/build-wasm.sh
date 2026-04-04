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
emcmake cmake .. -DCMAKE_BUILD_TYPE=Release
cmake --build . --parallel
