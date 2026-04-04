/** Loads C++ Oracle (Emscripten) and exposes the same operations main.ts needs. */

import oracleJsUrl from "./wasm/oracle.js?url";
import oracleWasmUrl from "./wasm/oracle.wasm?url";

export const PARTICLE_BYTE_STRIDE = 64;

export type AxisBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type ParticleInit = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  mass: number;
};

export type UiPeekEvent =
  | { kind: "pair"; time: number; a: number; b: number; countA: number; countB: number }
  | { kind: "wall"; time: number; particle: number; wall: string; countA: number };

export type UiHeapRow = {
  time: number;
  kind: "pair" | "wall";
  detail: string;
};

type EmscriptenModule = {
  _malloc(size: number): number;
  _free(ptr: number): void;
  /** Present when built with EXPORTED_RUNTIME_METHODS including HEAP* (see native/CMakeLists.txt). */
  HEAPF64?: Float64Array;
  HEAP32?: Int32Array;
  HEAPU8?: Uint8Array;
  wasmMemory?: WebAssembly.Memory;
  _oracle_create(
    maxN: number,
    minX: number,
    maxX: number,
    minY: number,
    maxY: number,
  ): number;
  _oracle_destroy(ctx: number): void;
  _oracle_set_particle_count(ctx: number, n: number): void;
  _oracle_set_particle(
    ctx: number,
    i: number,
    px: number,
    py: number,
    vx: number,
    vy: number,
    r: number,
    m: number,
  ): void;
  _oracle_bootstrap(ctx: number): void;
  _oracle_get_sim_time(ctx: number): number;
  _oracle_get_particle_count(ctx: number): number;
  _oracle_step(ctx: number, maxSteps: number): number;
  _oracle_purge_heap?(ctx: number): void;
  _oracle_peek_impact?(ctx: number, outX: number, outY: number): number;
  _oracle_particles_ptr(ctx: number): number;
  _oracle_heap_size(ctx: number): number;
  _oracle_peek_valid(ctx: number): number;
  _oracle_peek_time(ctx: number): number;
  _oracle_peek_kind(ctx: number): number;
  _oracle_peek_a(ctx: number): number;
  _oracle_peek_b(ctx: number): number;
  _oracle_peek_wall(ctx: number): number;
  _oracle_peek_count_a(ctx: number): number;
  _oracle_peek_count_b(ctx: number): number;
  _oracle_heap_export(
    ctx: number,
    times: number,
    kinds: number,
    ia: number,
    ib: number,
    walls: number,
    ca: number,
    cb: number,
    maxRows: number,
  ): number;
};

const WALL_NAMES = ["left", "right", "top", "bottom"] as const;

function wallName(w: number): string {
  return WALL_NAMES[w] ?? `wall_${w}`;
}

export class WasmOracle {
  private readonly mod: EmscriptenModule;
  private readonly ctx: number;
  private readonly exportMax = 64;
  private readonly pTimes: number;
  private readonly pKinds: number;
  private readonly pIa: number;
  private readonly pIb: number;
  private readonly pWalls: number;
  private readonly pCa: number;
  private readonly pCb: number;

  /** Linear memory backing the module (Emscripten may expose HEAPU8 or wasmMemory). */
  private heapBuffer(): ArrayBufferLike {
    const m = this.mod as EmscriptenModule & { wasmMemory?: WebAssembly.Memory };
    const b = m.HEAPU8?.buffer ?? m.wasmMemory?.buffer;
    if (!b) {
      throw new Error(
        "Emscripten heap not exposed on Module (HEAPU8/wasmMemory missing). Re-run: npm run build:wasm",
      );
    }
    return b;
  }

  private constructor(mod: EmscriptenModule, ctx: number) {
    this.mod = mod;
    this.ctx = ctx;
    const m = mod;
    const n = this.exportMax;
    this.pTimes = m._malloc(n * 8);
    this.pKinds = m._malloc(n * 4);
    this.pIa = m._malloc(n * 4);
    this.pIb = m._malloc(n * 4);
    this.pWalls = m._malloc(n * 4);
    this.pCa = m._malloc(n * 4);
    this.pCb = m._malloc(n * 4);
  }

  static async create(
    maxParticles: number,
    bounds: AxisBounds,
    particles: ParticleInit[],
  ): Promise<WasmOracle> {
    const createModule = (await import(/* @vite-ignore */ oracleJsUrl)).default as (
      opts?: Record<string, unknown>,
    ) => Promise<EmscriptenModule>;
    const jsDir = oracleJsUrl.replace(/[^/]+$/, "");
    const mod = await createModule({
      locateFile: (path: string) =>
        path.endsWith(".wasm") ? oracleWasmUrl : `${jsDir}${path}`,
    });
    const ctx = mod._oracle_create(
      maxParticles,
      bounds.minX,
      bounds.maxX,
      bounds.minY,
      bounds.maxY,
    );
    if (!ctx) {
      throw new Error("oracle_create failed");
    }
    mod._oracle_set_particle_count(ctx, particles.length);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      mod._oracle_set_particle(ctx, i, p.x, p.y, p.vx, p.vy, p.radius, p.mass);
    }
    mod._oracle_bootstrap(ctx);
    return new WasmOracle(mod, ctx);
  }

  get sim_time(): number {
    return this.mod._oracle_get_sim_time(this.ctx);
  }

  get heapSize(): number {
    return this.mod._oracle_heap_size(this.ctx);
  }

  get particleCount(): number {
    return this.mod._oracle_get_particle_count(this.ctx);
  }

  stepCollisions(maxSteps: number): void {
    this.mod._oracle_step(this.ctx, maxSteps);
  }

  /** Remove heap rows with event time strictly before current sim_time (UI sync). */
  purgeHeapPastSimTime(): void {
    const f = this.mod._oracle_purge_heap;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx);
  }

  /** World-space impact point for the next valid event (wall contact on arena edge, or pair rim). */
  peekNextImpact(): { x: number; y: number } | null {
    const m = this.mod;
    const peekImpact = m._oracle_peek_impact;
    if (typeof peekImpact !== "function") {
      return null;
    }
    const p = m._malloc(16);
    if (!p) {
      return null;
    }
    try {
      const ok = peekImpact(this.ctx, p, p + 8);
      if (!ok) {
        return null;
      }
      const f64 = m.HEAPF64;
      if (!f64) {
        return null;
      }
      const i = p >>> 3;
      return { x: f64[i], y: f64[i + 1] };
    } finally {
      m._free(p);
    }
  }

  /** Position at sim time `t` using linear motion from C++ particle state. */
  posAt(index: number, t: number): { x: number; y: number } {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    const px = d.getFloat64(0, true);
    const py = d.getFloat64(8, true);
    const vx = d.getFloat64(16, true);
    const vy = d.getFloat64(24, true);
    const lastT = d.getFloat64(48, true);
    const dt = t - lastT;
    return { x: px + vx * dt, y: py + vy * dt };
  }

  radiusAt(index: number): number {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    return d.getFloat64(32, true);
  }

  /** Current velocity (constant between collision events). */
  velocityAt(index: number): { vx: number; vy: number } {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    return { vx: d.getFloat64(16, true), vy: d.getFloat64(24, true) };
  }

  peekNextTime(): number | null {
    if (!this.mod._oracle_peek_valid(this.ctx)) {
      return null;
    }
    return this.mod._oracle_peek_time(this.ctx);
  }

  peekNextEvent(): UiPeekEvent | undefined {
    const m = this.mod;
    if (!m._oracle_peek_valid(this.ctx)) {
      return undefined;
    }
    const time = m._oracle_peek_time(this.ctx);
    const kind = m._oracle_peek_kind(this.ctx);
    if (kind === 0) {
      return {
        kind: "pair",
        time,
        a: m._oracle_peek_a(this.ctx),
        b: m._oracle_peek_b(this.ctx),
        countA: m._oracle_peek_count_a(this.ctx),
        countB: m._oracle_peek_count_b(this.ctx),
      };
    }
    return {
      kind: "wall",
      time,
      particle: m._oracle_peek_a(this.ctx),
      wall: wallName(m._oracle_peek_wall(this.ctx)),
      countA: m._oracle_peek_count_a(this.ctx),
    };
  }

  getQueuedEventsSorted(maxRows: number): UiHeapRow[] {
    const m = this.mod;
    const n = Math.min(maxRows, this.exportMax);
    const written = m._oracle_heap_export(
      this.ctx,
      this.pTimes,
      this.pKinds,
      this.pIa,
      this.pIb,
      this.pWalls,
      this.pCa,
      this.pCb,
      n,
    );
    const f64 = m.HEAPF64;
    const i32 = m.HEAP32;
    if (!f64 || !i32) {
      throw new Error(
        "HEAPF64/HEAP32 missing on Module. Re-run: npm run build:wasm (CMake exports heap views).",
      );
    }
    const t0 = this.pTimes >>> 3;
    const i0 = this.pKinds >>> 2;
    const times = f64.subarray(t0, t0 + written);
    const kinds = i32.subarray(i0, i0 + written);
    const ia = i32.subarray(this.pIa >>> 2, (this.pIa >>> 2) + written);
    const ib = i32.subarray(this.pIb >>> 2, (this.pIb >>> 2) + written);
    const walls = i32.subarray(this.pWalls >>> 2, (this.pWalls >>> 2) + written);
    const ca = i32.subarray(this.pCa >>> 2, (this.pCa >>> 2) + written);
    const cb = i32.subarray(this.pCb >>> 2, (this.pCb >>> 2) + written);

    const rows: UiHeapRow[] = [];
    for (let i = 0; i < written; i++) {
      const time = times[i];
      if (kinds[i] === 0) {
        rows.push({
          time,
          kind: "pair",
          detail: `p${ia[i]}·p${ib[i]} c=${ca[i]}/${cb[i]}`,
        });
      } else {
        rows.push({
          time,
          kind: "wall",
          detail: `p${ia[i]} ${wallName(walls[i])} c=${ca[i]}`,
        });
      }
    }
    return rows;
  }
}
