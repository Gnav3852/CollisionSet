# Oracle Engine — context for AI / code review

Paste this file (or its summary) before sharing a specific C++ or TypeScript path so the model understands how pieces fit together.

## What this repo is

A **2D discrete-event simulation (DES)** of **elastic disks in an axis-aligned box**. Bodies are **circles**; walls are **AABB** edges. Between collisions, motion is **constant velocity**; pair collisions use **elastic impulses** along the **line of centers**.

## Runtime stack

- **C++** physics core under `native/`
- **Emscripten** → `src/wasm/oracle.js` + `oracle.wasm`
- **TypeScript** (`src/oracleWasm.ts`, `src/main.ts`) + **Vite** canvas UI

After changing C++: `source …/emsdk_env.sh` then from repo root `npm run build:wasm`. The browser loads the WASM that matches the last successful build.

## Reference vs live TypeScript

| Role | Paths |
|------|--------|
| **Running sim** | `src/oracleWasm.ts`, `src/main.ts` |
| **Reference / comparison only** | `src/oracle.ts`, `src/heap.ts`, `src/collision-math.ts`, `src/particle.ts`, `src/event.ts` |

## Native (C++) layout

| Path | Role |
|------|------|
| `native/include/oracle/types.hpp` | `Particle` (64-byte POD for WASM), `SimEvent`, `AxisBounds`, `WallAxis`, numeric tolerances (`kEps`, `kTimeEps`, `kMinPairDt`, `kMinRelativeSpeed`, …) |
| `native/include/oracle/min_heap.hpp` | Min-heap keyed by event time |
| `native/include/oracle/collision_math.hpp` | `earliest_*` hit times, `resolve_elastic_pair(a,b,e)` (line-of-centers from positions + half separation nudge), `kPostCollisionSeparation` |
| `native/src/collision_math.cpp` | Wall/pair **prediction** (quadratic for pairs, approaching guard `dot(V,P)`, minimum `dt` floors), pair **resolve** |
| `native/include/oracle/oracle_engine.hpp` | `OracleEngine` API |
| `native/src/oracle_engine.cpp` | Bootstrap, `integrate_all`, **`process_next_collision`**, heap purge, peek next **valid** event, peek impact for UI |
| `native/src/bindings.cpp` | C exports for JS (`_oracle_*`) |

### Core DES semantics

1. **Lazy invalidation:** Each `SimEvent` stores **collision counts** at predict time. On pop, **`validate_event`** compares to live `Particle::collision_count`. Invalid events are discarded **without** advancing `sim_time_`.

2. **Valid event:** `integrate_all(e.time)` → **`sim_time_ = e.time`** (absolute event time, not `+= dt`) → `resolve_wall` / `resolve_pair` (velocity change + positional separation / clamp) → increment counts → **repredict** events involving affected particles.

3. **Prediction:** `predict_pair` / `predict_wall` use state at **`sim_time_`** and push future events onto the heap.

## TypeScript (live UI)

| Path | Role |
|------|------|
| `src/oracleWasm.ts` | Loads WASM; `WasmOracle`: `stepCollisions`, `posAt` / `radiusAt`, peek APIs, optional `purgeHeapPastSimTime`, heap export |
| `src/main.ts` | Canvas, HUD, **display sweep**: `displayTime` between last `sim_time` and next valid peek (or fallback); draws causality segment |

**Display vs simulation:** `sim_time` advances only when WASM steps collisions. Smooth motion between events is **interpolation for drawing**, not extra physics steps.

## WASM boundary

- Particle stride **64 bytes** — must match `PARTICLE_BYTE_STRIDE` in `oracleWasm.ts` and `static_assert` in `types.hpp`.
- New C symbols need `EXPORTED_FUNCTIONS` in `native/CMakeLists.txt` and, if called from TS, typings + methods in `oracleWasm.ts`.

## Suggested prompt pattern for another model

> Context: see `CONTEXT.md` in the Oracle repo (2D DES elastic disks, C++→WASM, TS UI).  
> Here is the file `…` — explain how X interacts with Y in the engine.
