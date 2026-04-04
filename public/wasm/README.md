WASM artifacts are emitted to **`src/wasm/`** (not here) so Vite can bundle them. Run:

```bash
npm run build:wasm
```

**Physics (C++ Oracle):** discrete-event simulation (DES), elastic disk–disk collisions, **head-on momentum exchange** along the line of centers (Princeton-style impulse / `dv·dr` approaching guard), post-collision **separation nudge** + clamp so pairs **bounce** instead of Zeno micro-collision loops.

See [`src/wasm/README.md`](../../src/wasm/README.md) and [`native/README.md`](../../native/README.md).
