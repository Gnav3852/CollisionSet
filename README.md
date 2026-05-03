# CollisionSet

**CollisionSet** is a browser demo of a **discrete-event simulation (DES)** for elastic hard spheres: **2D disks** in a box, or **3D billiards** in an axis-aligned volume (WASM + optional **Three.js** view). The **Oracle** core (C++ → **WebAssembly**) uses a **min-heap** event queue and **analytic** contact tests; the **Vite + TypeScript** UI interpolates strictly between `sim_time` and the next validated collision for **causal**, **tunnel-free** rendering.

## Features (UI)

- **Presets** — reseed scenarios: default multi-body, head-on (equal / unequal mass), Newton’s cradle, glancing & crossfire, inelastic demos, **Maxwell’s demon** (with divider), **3D mixed box**, and more.
- **Physics knobs** — restitution **e**, gravity, **per-particle mass** sliders; **KE baseline reset** and drift readout for sanity checks.
- **2D-only lab** — periodic **torus** walls, **collision heatmap**, **temperature field**, **motion trails**, **ghost** positions, live **priority-queue** table of upcoming wall/pair events.
- **Maxwell demon** — sliding divider, door, gap height, optional auto door; **strip chart** of left/right “temperatures” and **|T_L - T_R|**.
- **3D box (Three.js)** — full **XYZ** simulation with orbit camera; torus, heatmap, demon, and related 2D-only toggles are disabled in 3D (see in-app hint).
- **Transport** — pause, oracle steps per frame, **display sweep** duration, manual **scrub** along the causal segment; keyboard shortcuts (see sidebar).

## Screenshots

<img width="3024" height="1736" alt="image" src="https://github.com/user-attachments/assets/c93ebcb7-d05c-4d29-88cd-7404625cc1f8" />
<img width="3024" height="1724" alt="image" src="https://github.com/user-attachments/assets/324e32e0-a924-4a4f-a01c-4f57f40aa7a0" />
<img width="3004" height="1708" alt="image" src="https://github.com/user-attachments/assets/8431c612-b81b-43b7-960d-4382b32613bd" />


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

| Command              | Description                                                  |
| -------------------- | ------------------------------------------------------------ |
| `npm run dev`        | Dev server with HMR                                          |
| `npm run dev:emsdk`  | Source `../emsdk/emsdk_env.sh`, then dev server (see script) |
| `npm run build`      | Typecheck + production bundle (`dist/`)                      |
| `npm run preview`    | Serve `dist/` locally                                        |
| `npm run build:wasm` | Compile C++ → `src/wasm/` (requires `emcmake`)              |

After changing **C++**, run `npm run build:wasm` again before expecting updated behavior in the browser.

## Controls (UI)

- **Pause Oracle** — freeze physics (display can still sweep if not in manual scrub).
- **Oracle steps / frame** — how many validated collisions to process per animation frame.
- **Display sweep** — wall-clock duration to interpolate between `sim_time` and the next heap event.
- **Scrub** — manual timeline between current sim time and next event.
- **3D box (Three.js)** — toggles **XYZ** mode and the WebGL view (2D-only features disabled; see **Features** above).
- **Keyboard:** `Space` toggles pause; arrow keys adjust sweep (see sidebar hint). `Shift` + arrows = larger steps.

## Repository layout

```
src/main.ts          # Canvas, controls, presets, strip chart, boot
src/scene3d.ts       # Three.js orbit view for 3D WASM box
src/oracleWasm.ts    # Loads WASM module, reads heap / exports
src/wasm/            # Emscripten output (+ stub until you run build:wasm)
native/              # C++ Oracle engine, CMake, Emscripten bindings
scripts/build-wasm.sh
```

TypeScript reference implementations (`src/oracle.ts`, `src/collision-math.ts`, etc.) are kept for comparison; the running sim uses **WASM** via `oracleWasm.ts`.

## Requirements

- **Node.js** 18+ (for Vite 6)
- **Emscripten + CMake** — only if you run `npm run build:wasm`
