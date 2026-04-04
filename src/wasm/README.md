Checked-in **stub** `oracle.js` / minimal `oracle.wasm` exist so Vite can resolve imports before you build. Running:

```bash
npm run build:wasm
```

(with Emscripten on your `PATH`; see [`native/README.md`](../../native/README.md)) **overwrites** them with real Emscripten output.

Vite imports these as `?url` assets from [`oracleWasm.ts`](../oracleWasm.ts). Do not move them to `public/` — files under `public/` cannot be imported from TypeScript.
