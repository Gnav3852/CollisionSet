# C++ Oracle (WebAssembly)

The discrete-event physics core lives here and is compiled with **Emscripten** into `src/wasm/oracle.js` and `src/wasm/oracle.wasm` (Vite `?url` assets; not under `public/`).

## Prerequisites

1. Install [Emscripten](https://emscripten.org/docs/getting_started/downloads.html) (e.g. clone `emsdk`, `./emsdk install latest`, `./emsdk activate latest`).
2. In each terminal session where you build:

```bash
source /path/to/emsdk/emsdk_env.sh
```

## Build

From the repository root:

```bash
npm run build:wasm
```

This configures `native/build` with `emcmake` and copies the artifacts into `src/wasm/`.

## Layout

- `include/oracle/` — types, min-heap, collision math declarations, `OracleEngine`
- `src/` — collision math, engine, Emscripten C bindings

The TypeScript UI loads the module via [`src/oracleWasm.ts`](../src/oracleWasm.ts) (`import … from "./wasm/oracle.js?url"`).
