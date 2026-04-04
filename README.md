# Oracle Engine

A **discrete-event simulation (DES)** for 2D elastic disks in a box. The **Oracle** advances exact collision times (priority queue + analytic hit tests) in **C++ compiled to WebAssembly**; the **Ticker** is a Vite + TypeScript canvas UI that interpolates motion for display.

Photos and Sweep Frames:

Ex 1: 
<img width="2410" height="1388" alt="image" src="https://github.com/user-attachments/assets/a5358b19-b801-4c30-8803-2a0db950c604" />

<img width="2398" height="1380" alt="image" src="https://github.com/user-attachments/assets/157032ea-bf48-416c-a6b5-cebeacad1b7a" />

<img width="2460" height="1400" alt="image" src="https://github.com/user-attachments/assets/f847f3ae-12be-4e46-8b56-333ba91fe8df" />

Ex2: 

<img width="2630" height="1370" alt="image" src="https://github.com/user-attachments/assets/3bfe1dab-2547-408f-bcd5-630ba0359694" />

<img width="2556" height="1488" alt="image" src="https://github.com/user-attachments/assets/282d3ed0-6332-4bae-999c-b2a8617559db" />

<img width="2614" height="1344" alt="image" src="https://github.com/user-attachments/assets/ee36b3e4-ee84-4502-80b0-91e32403f4ef" />

<img width="2528" height="1454" alt="image" src="https://github.com/user-attachments/assets/2dfeb15e-99c1-4e87-ba3a-e59ab9529586" />



## Quick start

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually `http://localhost:5173`).

If **Emscripten** lives as a sibling folder `../emsdk` (same parent directory as this repo), you can start the dev server with the SDK on your `PATH` in one step:

```bash
npm run dev:emsdk
```

That runs [`scripts/dev-with-emsdk.sh`](scripts/dev-with-emsdk.sh) (sources `../emsdk/emsdk_env.sh`, then `npm run dev`). If emsdk is elsewhere, set `EMSDK_ENV` to the full path of `emsdk_env.sh` before running the script.

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
| `npm run dev:emsdk` | Source `../emsdk/emsdk_env.sh`, then dev server (see script) |
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
