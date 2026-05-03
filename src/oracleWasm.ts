/** Loads C++ Oracle (Emscripten) and exposes the same operations main.ts needs. */

import oracleJsUrl from "./wasm/oracle.js?url";
import oracleWasmUrl from "./wasm/oracle.wasm?url";

/** Must match native `Particle` in types.hpp (80 bytes). */
export const PARTICLE_BYTE_STRIDE = 80;

/** Axis-aligned box used by WASM `VolumeBounds`. */
export type VolumeBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/** @deprecated Use VolumeBounds — kept for call sites that only pass XY (add minZ/maxZ). */
export type AxisBounds = VolumeBounds;

export type ParticleInit = {
  x: number;
  y: number;
  z?: number;
  vx: number;
  vy: number;
  vz?: number;
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
    minZ: number,
    maxZ: number,
  ): number;
  _oracle_destroy(ctx: number): void;
  _oracle_set_particle_count(ctx: number, n: number): void;
  _oracle_set_particle(
    ctx: number,
    i: number,
    px: number,
    py: number,
    pz: number,
    vx: number,
    vy: number,
    vz: number,
    r: number,
    m: number,
  ): void;
  _oracle_set_space_mode?(ctx: number, mode: number): void;
  _oracle_get_space_mode?(ctx: number): number;
  _oracle_set_restitution?(ctx: number, e: number): void;
  _oracle_set_gravity?(ctx: number, ax: number, ay: number, az: number): void;
  _oracle_get_gravity?(ctx: number, outAx: number, outAy: number, outAz: number): void;
  _oracle_set_torus_mode?(ctx: number, on: number): void;
  _oracle_set_divider_active?(ctx: number, on: number): void;
  _oracle_set_door_open?(ctx: number, open: number): void;
  _oracle_set_divider_geometry?(
    ctx: number,
    xs: number,
    gapTop: number,
    gapBot: number,
  ): void;
  _oracle_get_divider_x?(ctx: number): number;
  _oracle_get_gap_top?(ctx: number): number;
  _oracle_get_gap_bot?(ctx: number): number;
  _oracle_get_door_open?(ctx: number): number;
  _oracle_get_divider_active?(ctx: number): number;
  _oracle_bootstrap(ctx: number): void;
  _oracle_get_sim_time(ctx: number): number;
  _oracle_get_particle_count(ctx: number): number;
  _oracle_step(ctx: number, maxSteps: number): number;
  _oracle_purge_heap?(ctx: number): void;
  _oracle_peek_impact?(ctx: number, outX: number, outY: number, outZ: number): number;
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

const WALL_NAMES = ["left", "right", "top", "bottom", "divider", "nearZ", "farZ"] as const;

function wallName(w: number): string {
  return WALL_NAMES[w] ?? `wall_${w}`;
}

export class WasmOracle {
  private readonly mod: EmscriptenModule;
  private readonly ctx: number;
  /** Volume passed to `oracle_create` (WASM does not expose getters; keep a copy for reseed defaults). */
  private readonly boundsVol: VolumeBounds;
  /** Mirrors WASM `OracleEngine::gravity_` for client-side `posAt` / `velocityAt` (same px/s²). */
  private grav = { x: 0, y: 0, z: 0 };
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

  private constructor(mod: EmscriptenModule, ctx: number, boundsVol: VolumeBounds) {
    this.mod = mod;
    this.ctx = ctx;
    this.boundsVol = boundsVol;
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
    bounds: VolumeBounds,
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
      bounds.minZ,
      bounds.maxZ,
    );
    if (!ctx) {
      throw new Error("oracle_create failed");
    }
    mod._oracle_set_particle_count(ctx, particles.length);
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const z = p.z ?? 0.5 * (bounds.minZ + bounds.maxZ);
      const vz = p.vz ?? 0;
      mod._oracle_set_particle(ctx, i, p.x, p.y, z, p.vx, p.vy, vz, p.radius, p.mass);
    }
    mod._oracle_bootstrap(ctx);
    return new WasmOracle(mod, ctx, bounds);
  }

  /**
   * Replace the current particle population and re-bootstrap in-place, without
   * tearing down the Emscripten Module (cheap preset swap). `set_particle` zeroes
   * collision_count + last_update_time and `bootstrap` clears the heap & re-predicts,
   * so no stale events survive.
   */
  reseed(particles: ParticleInit[], bounds?: VolumeBounds): void {
    const m = this.mod;
    m._oracle_set_particle_count(this.ctx, particles.length);
    const b = bounds ?? this.boundsVol;
    for (let i = 0; i < particles.length; i++) {
      const p = particles[i];
      const z = p.z ?? 0.5 * (b.minZ + b.maxZ);
      const vz = p.vz ?? 0;
      m._oracle_set_particle(this.ctx, i, p.x, p.y, z, p.vx, p.vy, vz, p.radius, p.mass);
    }
    m._oracle_bootstrap(this.ctx);
  }

  /** XY = 2D arena + divider/torus; XYZ = full 3D box (divider/torus inactive). */
  setSpaceMode(xyz: boolean): void {
    const f = this.mod._oracle_set_space_mode;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx, xyz ? 1 : 0);
  }

  get spaceModeIsXYZ(): boolean {
    const f = this.mod._oracle_get_space_mode;
    return typeof f === "function" ? f(this.ctx) !== 0 : false;
  }

  volumeBounds(): VolumeBounds {
    return { ...this.boundsVol };
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

  /** Returns the number of collision events actually applied (≤ maxSteps). */
  stepCollisions(maxSteps: number): number {
    return this.mod._oracle_step(this.ctx, maxSteps);
  }

  /** Mass of particle `i` (offset 56; see types.hpp Particle). */
  massAt(index: number): number {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    return d.getFloat64(56, true);
  }

  /** Lifetime collision count for particle `i` (offset 72, int32). */
  collisionCountAt(index: number): number {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    return d.getInt32(72, true);
  }

  /**
   * Write mass in-place without going through `_oracle_set_particle` (which would
   * zero `collision_count` and `last_update_time`, invalidating every queued event
   * referencing this particle). Direct write is safe: pair-event timing depends only
   * on position/velocity/radius; mass enters at collision *resolution*, so the heap
   * stays consistent.
   */
  setMass(index: number, mass: number): void {
    const safe = Math.max(1e-6, mass);
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    d.setFloat64(56, safe, true);
  }

  /** Σ ½ m (vx² + vy² + vz²) across all active particles. */
  totalKE(): number {
    const n = this.particleCount;
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const buf = this.heapBuffer();
    let ke = 0;
    for (let i = 0; i < n; i++) {
      const d = new DataView(buf, ptr + i * PARTICLE_BYTE_STRIDE, PARTICLE_BYTE_STRIDE);
      const vx = d.getFloat64(24, true);
      const vy = d.getFloat64(32, true);
      const vz = d.getFloat64(40, true);
      const m = d.getFloat64(56, true);
      ke += 0.5 * m * (vx * vx + vy * vy + vz * vz);
    }
    return ke;
  }

  /** Total momentum vector and its magnitude across all active particles. */
  totalMomentum(): { px: number; py: number; pz: number; mag: number } {
    const n = this.particleCount;
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const buf = this.heapBuffer();
    let px = 0;
    let py = 0;
    let pz = 0;
    for (let i = 0; i < n; i++) {
      const d = new DataView(buf, ptr + i * PARTICLE_BYTE_STRIDE, PARTICLE_BYTE_STRIDE);
      const vx = d.getFloat64(24, true);
      const vy = d.getFloat64(32, true);
      const vz = d.getFloat64(40, true);
      const m = d.getFloat64(56, true);
      px += m * vx;
      py += m * vy;
      pz += m * vz;
    }
    return { px, py, pz, mag: Math.hypot(px, py, pz) };
  }

  /** Σ per-particle collision_count. Pair collisions contribute 2, wall bounces 1. */
  totalCollisionIncrements(): number {
    const n = this.particleCount;
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const buf = this.heapBuffer();
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const d = new DataView(buf, ptr + i * PARTICLE_BYTE_STRIDE, PARTICLE_BYTE_STRIDE);
      sum += d.getInt32(72, true);
    }
    return sum;
  }

  /** Coefficient of restitution for pair collisions (clamped to [0,1] in C++). */
  setRestitution(e: number): void {
    const f = this.mod._oracle_set_restitution;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx, e);
  }

  /** Uniform acceleration in world px/s² (same units as positions). Pair prediction unchanged; walls use quadratics. */
  setGravity(ax: number, ay: number, az: number): void {
    const f = this.mod._oracle_set_gravity;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx, ax, ay, az);
    this.grav = { x: ax, y: ay, z: az };
  }

  getGravity(): { x: number; y: number; z: number } {
    const m = this.mod;
    const f = m._oracle_get_gravity;
    if (typeof f !== "function") {
      return { x: 0, y: 0, z: 0 };
    }
    const p = m._malloc(24);
    if (!p) {
      return { x: 0, y: 0, z: 0 };
    }
    try {
      f(this.ctx, p, p + 8, p + 16);
      const f64 = m.HEAPF64;
      if (!f64) {
        return { x: 0, y: 0, z: 0 };
      }
      const i = p >>> 3;
      return { x: f64[i], y: f64[i + 1], z: f64[i + 2] };
    } finally {
      m._free(p);
    }
  }

  /** Enable/disable periodic (torus) boundaries. Rewraps particles and invalidates queued events. */
  setTorusMode(on: boolean): void {
    const f = this.mod._oracle_set_torus_mode;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx, on ? 1 : 0);
  }

  /**
   * Maxwell divider: a vertical wall at x = divider_x with a centered gap
   * spanning [gap_top, gap_bot]. When the door is open, balls crossing within
   * the gap pass freely; otherwise they bounce. State changes invalidate all
   * queued events and re-predict (same mechanism as torus toggle).
   */
  setDividerActive(on: boolean): void {
    const f = this.mod._oracle_set_divider_active;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx, on ? 1 : 0);
  }

  setDoorOpen(open: boolean): void {
    const f = this.mod._oracle_set_door_open;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx, open ? 1 : 0);
  }

  setDividerGeometry(xs: number, gapTop: number, gapBot: number): void {
    const f = this.mod._oracle_set_divider_geometry;
    if (typeof f !== "function") {
      return;
    }
    f(this.ctx, xs, gapTop, gapBot);
  }

  get dividerActive(): boolean {
    const f = this.mod._oracle_get_divider_active;
    return typeof f === "function" ? f(this.ctx) !== 0 : false;
  }

  get doorOpen(): boolean {
    const f = this.mod._oracle_get_door_open;
    return typeof f === "function" ? f(this.ctx) !== 0 : false;
  }

  get dividerX(): number {
    const f = this.mod._oracle_get_divider_x;
    return typeof f === "function" ? f(this.ctx) : 0;
  }

  get gapTop(): number {
    const f = this.mod._oracle_get_gap_top;
    return typeof f === "function" ? f(this.ctx) : 0;
  }

  get gapBot(): number {
    const f = this.mod._oracle_get_gap_bot;
    return typeof f === "function" ? f(this.ctx) : 0;
  }

  /**
   * Aggregate per-side stats relative to x = splitX (defaults to divider_x).
   * Returns counts and kinetic energies on each half, plus total mass — used
   * for temperature readouts, demon decisions, and entropy bookkeeping.
   */
  splitStats(splitX?: number): {
    nL: number;
    nR: number;
    keL: number;
    keR: number;
    mL: number;
    mR: number;
  } {
    const x0 = splitX ?? this.dividerX;
    const n = this.particleCount;
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const buf = this.heapBuffer();
    let nL = 0;
    let nR = 0;
    let keL = 0;
    let keR = 0;
    let mL = 0;
    let mR = 0;
    for (let i = 0; i < n; i++) {
      const d = new DataView(buf, ptr + i * PARTICLE_BYTE_STRIDE, PARTICLE_BYTE_STRIDE);
      const px = d.getFloat64(0, true);
      const vx = d.getFloat64(24, true);
      const vy = d.getFloat64(32, true);
      const vz = d.getFloat64(40, true);
      const m = d.getFloat64(56, true);
      const ke = 0.5 * m * (vx * vx + vy * vy + vz * vz);
      if (px < x0) {
        nL += 1;
        keL += ke;
        mL += m;
      } else {
        nR += 1;
        keR += ke;
        mR += m;
      }
    }
    return { nL, nR, keL, keR, mL, mR };
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
  peekNextImpact(): { x: number; y: number; z: number } | null {
    const m = this.mod;
    const peekImpact = m._oracle_peek_impact;
    if (typeof peekImpact !== "function") {
      return null;
    }
    const p = m._malloc(24);
    if (!p) {
      return null;
    }
    try {
      const ok = peekImpact(this.ctx, p, p + 8, p + 16);
      if (!ok) {
        return null;
      }
      const f64 = m.HEAPF64;
      if (!f64) {
        return null;
      }
      const i = p >>> 3;
      return { x: f64[i], y: f64[i + 1], z: f64[i + 2] };
    } finally {
      m._free(p);
    }
  }

  /** Position at sim time `t` (constant acceleration segment; matches C++ `pos_at`). */
  posAt(index: number, t: number): { x: number; y: number; z: number } {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    const px = d.getFloat64(0, true);
    const py = d.getFloat64(8, true);
    const pz = d.getFloat64(16, true);
    const vx = d.getFloat64(24, true);
    const vy = d.getFloat64(32, true);
    const vz = d.getFloat64(40, true);
    const lastT = d.getFloat64(64, true);
    const dt = t - lastT;
    const gx = this.grav.x;
    const gy = this.grav.y;
    const gz = this.spaceModeIsXYZ ? this.grav.z : 0;
    const half = 0.5 * dt * dt;
    return {
      x: px + vx * dt + gx * half,
      y: py + vy * dt + gy * half,
      z: pz + vz * dt + gz * half,
    };
  }

  radiusAt(index: number): number {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    return d.getFloat64(48, true);
  }

  /** Velocity at sim time `t` along the same constant-acceleration segment as `posAt`. */
  velocityAt(index: number, t: number): { vx: number; vy: number; vz: number } {
    const ptr = this.mod._oracle_particles_ptr(this.ctx);
    const base = ptr + index * PARTICLE_BYTE_STRIDE;
    const d = new DataView(this.heapBuffer(), base, PARTICLE_BYTE_STRIDE);
    const vx0 = d.getFloat64(24, true);
    const vy0 = d.getFloat64(32, true);
    const vz0 = d.getFloat64(40, true);
    const lastT = d.getFloat64(64, true);
    const dt = t - lastT;
    const gx = this.grav.x;
    const gy = this.grav.y;
    const gz = this.spaceModeIsXYZ ? this.grav.z : 0;
    return {
      vx: vx0 + gx * dt,
      vy: vy0 + gy * dt,
      vz: vz0 + gz * dt,
    };
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
