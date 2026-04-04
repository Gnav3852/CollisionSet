# Oracle Engine

A **discrete-event simulation (DES)** for 2D elastic disks in a box. The **Oracle** advances exact collision times (priority queue + analytic hit tests) in **C++ compiled to WebAssembly**; the **Ticker** is a Vite + TypeScript canvas UI that interpolates motion for display.

## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

The repo includes a small **stub** `src/wasm/oracle.js` so the app loads before you build native code. For the real physics core, build WASM once (see below).

## Build the WASM Oracle (optional first time)

You need [Emscripten](https://emscripten.org/) and **CMake** on your `PATH`.

```bash
source /path/to/emsdk/emsdk_env.sh   # each new terminal
npm run build:wasm
```

This writes `src/wasm/oracle.js` and `src/wasm/oracle.wasm`. Details: [`native/README.md`](native/README.md).

## Scripts

| Command | Description |
|--------|-------------|
| `npm run dev` | Dev server with HMR |
| `npm run build` | Typecheck + production bundle (`dist/`) |
| `npm run preview` | Serve `dist/` locally |
| `npm run build:wasm` | Compile C++ → `src/wasm/` (requires `emcmake`) |

After changing **C++**, run `npm run build:wasm` again before expecting updated behavior in the browser.

## Controls (UI)

- **Pause Oracle** — freeze physics (display can still sweep if not in manual scrub).
- **Oracle steps / frame** — how many validated collisions to process per animation frame.
- **Display sweep** — wall-clock duration to interpolate between `sim_time` and the next heap event.
- **Scrub** — manual timeline between current sim time and next event.
- **Keyboard:** `Space` toggles pause; arrow keys adjust sweep (see sidebar hint). `Shift` + arrows = larger steps.

## Repository layout

```
src/main.ts          # Canvas, controls, keyboard, boot
src/oracleWasm.ts    # Loads WASM module, reads heap / exports
src/wasm/            # Emscripten output (+ stub until you run build:wasm)
native/              # C++ Oracle, CMake, Emscripten bindings
scripts/build-wasm.sh
```

TypeScript reference implementations (`src/oracle.ts`, `src/collision-math.ts`, etc.) are kept for comparison; the running sim uses **WASM** via `oracleWasm.ts`.

## Requirements

- **Node.js** 18+ (for Vite 6)
- **Emscripten + CMake** — only if you run `npm run build:wasm`
