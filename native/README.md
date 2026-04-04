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

### Zeno diagnostics (optional)

To compile with the **circuit breaker** and verbose pair/quadratic `std::cout` logging (browser devtools console), enable the CMake option before building:

```bash
ORACLE_ZENO_DEBUG=1 npm run build:wasm
# or: npm run build:wasm:debug
```

Leave this **off** for normal dev and production artifacts; it is only for diagnosing micro-collision / heap churn.

Both commands configure `native/build` with `emcmake` and copy artifacts into `src/wasm/`. After pulling C++ changes (heap purge, peek impact, separation nudge, etc.), run a wasm build again so `oracle.wasm` exports stay in sync with [`src/oracleWasm.ts`](../src/oracleWasm.ts).

## Layout

- `include/oracle/` — types, min-heap, collision math declarations, `OracleEngine`
- `src/` — collision math, engine, Emscripten C bindings

The TypeScript UI loads the module via [`src/oracleWasm.ts`](../src/oracleWasm.ts) (`import … from "./wasm/oracle.js?url"`).
