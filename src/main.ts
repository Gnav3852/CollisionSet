import type { ParticleInit, UiHeapRow, UiPeekEvent, VolumeBounds } from "./oracleWasm";
import { WasmOracle } from "./oracleWasm";
import { Scene3D } from "./scene3d";

type Preset = {
  id: string;
  name: string;
  description: string;
  restitution: number;
  particles: ParticleInit[];
  /** `xyz` = full 3D box (divider/torus/heatmap off); omit or `xy` = 2D arena. */
  space?: "xy" | "xyz";
  /** If present, configure the Maxwell divider before bootstrap-predict runs. */
  divider?: { active: boolean; doorOpen: boolean; demonAuto: boolean };
};

const canvas = document.getElementById("sim") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLDivElement;
const queueBody = document.getElementById("queue-body") as HTMLTableSectionElement;
const stepsSlider = document.getElementById("steps") as HTMLInputElement;
const stepsVal = document.getElementById("steps-val") as HTMLSpanElement;
const sweepSlider = document.getElementById("sweep") as HTMLInputElement;
const sweepVal = document.getElementById("sweep-val") as HTMLSpanElement;
const pauseSim = document.getElementById("pause-sim") as HTMLInputElement;
const scrubSlider = document.getElementById("scrub") as HTMLInputElement;
const scrubVal = document.getElementById("scrub-val") as HTMLSpanElement;
const scrubLock = document.getElementById("scrub-lock") as HTMLInputElement;
const restiSlider = document.getElementById("resti") as HTMLInputElement;
const restiVal = document.getElementById("resti-val") as HTMLSpanElement;
const gravityYSlider = document.getElementById("gravity-y") as HTMLInputElement;
const gravityYVal = document.getElementById("gravity-y-val") as HTMLSpanElement;
const massRows = document.getElementById("mass-rows") as HTMLDivElement;
const presetList = document.getElementById("preset-list") as HTMLDivElement;
const presetDesc = document.getElementById("preset-desc") as HTMLParagraphElement;
const resetBaselineBtn = document.getElementById("reset-baseline") as HTMLButtonElement;
const viewHeatmap = document.getElementById("view-heatmap") as HTMLInputElement;
const viewTempField = document.getElementById("view-tempfield") as HTMLInputElement;
const viewTrails = document.getElementById("view-trails") as HTMLInputElement;
const viewGhosts = document.getElementById("view-ghosts") as HTMLInputElement;
const torusModeBox = document.getElementById("torus-mode") as HTMLInputElement;
const dividerActiveBox = document.getElementById("divider-active") as HTMLInputElement;
const doorBtn = document.getElementById("door-btn") as HTMLButtonElement;
const gapSlider = document.getElementById("gap") as HTMLInputElement;
const gapVal = document.getElementById("gap-val") as HTMLSpanElement;
const demonAutoBox = document.getElementById("demon-auto") as HTMLInputElement;
const statLEl = document.getElementById("stat-l") as HTMLSpanElement;
const statREl = document.getElementById("stat-r") as HTMLSpanElement;
const tLEl = document.getElementById("t-l") as HTMLSpanElement;
const tREl = document.getElementById("t-r") as HTMLSpanElement;
const sGasEl = document.getElementById("s-gas") as HTMLSpanElement;
const sInfoEl = document.getElementById("s-info") as HTMLSpanElement;
const sTogglesEl = document.getElementById("s-toggles") as HTMLSpanElement;
const stripChart = document.getElementById("strip-chart") as HTMLCanvasElement;
const stripCtx = stripChart.getContext("2d")!;
const view3dWrap = document.getElementById("view-3d-wrap") as HTMLDivElement;
const space3dBox = document.getElementById("space-3d") as HTMLInputElement;
const stripLegend = document.getElementById("strip-legend") as HTMLDivElement;
const demonPanel = document.getElementById("demon-panel") as HTMLDivElement;

const ctx = canvas.getContext("2d")!;

const W = canvas.width;
const H = canvas.height;
const padding = 24;
const bounds: VolumeBounds = {
  minX: padding,
  maxX: W - padding,
  minY: padding,
  maxY: H - padding,
  minZ: padding,
  maxZ: H - padding,
};

/** ~4 s to cross inner box width at max initial speed (atmospheric drift). */
const innerWidth = bounds.maxX - bounds.minX;
const vMax = innerWidth / 4;
const rawVel = [
  { vx: 200, vy: 60 },
  { vx: -190, vy: -40 },
  { vx: -80, vy: 180 },
  { vx: 150, vy: -130 },
] as const;
let maxSpeed = 0;
for (const v of rawVel) {
  maxSpeed = Math.max(maxSpeed, Math.hypot(v.vx, v.vy));
}
const vScale = maxSpeed > 0 ? vMax / maxSpeed : 1;
const particleSeed: ParticleInit[] = [
  { x: 160, y: 280, vx: rawVel[0].vx * vScale, vy: rawVel[0].vy * vScale, radius: 22, mass: 1.0 },
  { x: 640, y: 300, vx: rawVel[1].vx * vScale, vy: rawVel[1].vy * vScale, radius: 26, mass: 1.7 },
  { x: 260, y: 110, vx: rawVel[2].vx * vScale, vy: rawVel[2].vy * vScale, radius: 18, mass: 0.8 },
  { x: 540, y: 460, vx: rawVel[3].vx * vScale, vy: rawVel[3].vy * vScale, radius: 24, mass: 1.4 },
];

/**
 * Curated scenarios. Click a preset to reseed the engine, reset HUD baselines,
 * and rebuild mass sliders. `restitution` is applied after reseed so you can
 * author inelastic demos without touching the slider first.
 *
 * Positions are px, velocities are px/sim-s. Keep speeds ≤ ~300 so visual motion
 * stays in the heatmap's sweet spot against the current `vMax` derived from the
 * default seed (~188 px/s — faster speeds just clamp to max-red on the heatmap).
 */
const PRESETS: Preset[] = [
  {
    id: "default",
    name: "Default · 4 bouncers",
    description: "The stock scene: 4 balls, varied mass and radius.",
    restitution: 1.0,
    particles: particleSeed,
  },
  {
    id: "head-on-eq",
    name: "Head-on · equal mass",
    description: "Two equal balls, head-on. They swap velocities → one stops, the other continues.",
    restitution: 1.0,
    particles: [
      { x: 200, y: 280, vx: 220, vy: 0, radius: 22, mass: 1.0 },
      { x: 600, y: 280, vx: -220, vy: 0, radius: 22, mass: 1.0 },
    ],
  },
  {
    id: "head-on-4to1",
    name: "Head-on · 4:1 mass",
    description: "Heavy slow meets light fast. Light bounces back hard, heavy barely deflects.",
    restitution: 1.0,
    particles: [
      { x: 200, y: 280, vx: 120, vy: 0, radius: 30, mass: 4.0 },
      { x: 600, y: 280, vx: -120, vy: 0, radius: 16, mass: 1.0 },
    ],
  },
  {
    id: "cradle",
    name: "Newton's cradle",
    description: "5 equal balls almost touching. Momentum chains through to the last ball.",
    restitution: 1.0,
    particles: [
      { x: 200, y: 280, vx: 220, vy: 0, radius: 18, mass: 1.0 },
      { x: 237, y: 280, vx: 0, vy: 0, radius: 18, mass: 1.0 },
      { x: 274, y: 280, vx: 0, vy: 0, radius: 18, mass: 1.0 },
      { x: 311, y: 280, vx: 0, vy: 0, radius: 18, mass: 1.0 },
      { x: 348, y: 280, vx: 0, vy: 0, radius: 18, mass: 1.0 },
    ],
  },
  {
    id: "glance",
    name: "Glancing angle",
    description: "Equal balls passing with a small vertical offset — only the line-of-centers component exchanges.",
    restitution: 1.0,
    particles: [
      { x: 180, y: 270, vx: 240, vy: 0, radius: 22, mass: 1.0 },
      { x: 620, y: 296, vx: -240, vy: 0, radius: 22, mass: 1.0 },
    ],
  },
  {
    id: "crossfire",
    name: "Crossfire",
    description: "4 balls converging on the center. Chaos, but KE stays pinned with e=1.",
    restitution: 1.0,
    particles: [
      { x: 150, y: 150, vx: 180, vy: 120, radius: 20, mass: 1.0 },
      { x: 650, y: 150, vx: -180, vy: 120, radius: 22, mass: 1.4 },
      { x: 150, y: 410, vx: 180, vy: -120, radius: 18, mass: 0.8 },
      { x: 650, y: 410, vx: -180, vy: -120, radius: 24, mass: 1.7 },
    ],
  },
  {
    id: "inelastic-demo",
    name: "Inelastic · e=0.6",
    description: "Same 4-ball default but restitution 0.6 — watch KE bleed ~40% per pair collision.",
    restitution: 0.6,
    particles: particleSeed,
  },
  {
    id: "maxwell-demon",
    name: "Maxwell's demon",
    description:
      "8 balls, mixed speeds, divider down the middle. Flip the auto-demon on and watch L cool while R heats — entropy flows uphill at the cost of 'info bits'.",
    restitution: 1.0,
    divider: { active: true, doorOpen: false, demonAuto: false },
    particles: [
      { x: 160, y: 140, vx: 280, vy: 70, radius: 14, mass: 1.0 },
      { x: 240, y: 320, vx: -90, vy: 50, radius: 14, mass: 1.0 },
      { x: 320, y: 200, vx: 200, vy: -60, radius: 14, mass: 1.0 },
      { x: 160, y: 440, vx: 60, vy: -240, radius: 14, mass: 1.0 },
      { x: 560, y: 140, vx: 95, vy: -50, radius: 14, mass: 1.0 },
      { x: 640, y: 320, vx: -260, vy: 80, radius: 14, mass: 1.0 },
      { x: 540, y: 200, vx: -70, vy: 220, radius: 14, mass: 1.0 },
      { x: 620, y: 440, vx: -120, vy: -110, radius: 14, mass: 1.0 },
    ],
  },
  {
    id: "3d-mixed-box",
    space: "xyz",
    name: "3D · mixed box",
    description:
      "Eight spheres with Z motion in the same numeric volume. Orbit the camera — divider / torus / heatmap are off in 3D.",
    restitution: 1.0,
    particles: [
      { x: 180, y: 220, z: 200, vx: 150, vy: 70, vz: 110, radius: 16, mass: 1.0 },
      { x: 620, y: 240, z: 420, vx: -170, vy: 40, vz: -90, radius: 16, mass: 1.0 },
      { x: 320, y: 120, z: 300, vx: 90, vy: 160, vz: -50, radius: 14, mass: 1.0 },
      { x: 520, y: 400, z: 160, vx: -100, vy: -130, vz: 85, radius: 15, mass: 1.0 },
      { x: 240, y: 380, z: 440, vx: 130, vy: -60, vz: -70, radius: 14, mass: 1.0 },
      { x: 580, y: 140, z: 360, vx: -60, vy: 180, vz: 40, radius: 15, mass: 1.0 },
      { x: 400, y: 300, z: 260, vx: 40, vy: -100, vz: 130, radius: 13, mass: 1.0 },
      { x: 440, y: 180, z: 480, vx: -50, vy: 90, vz: -100, radius: 14, mass: 1.0 },
    ],
  },
];

const MAX_QUEUE_ROWS = 40;
const MAX_PARTICLES = 16;

const TRAIL_LEN = 56;
type TrailSample = { x: number; y: number; hue: number };
const trails: TrailSample[][] = [];
let lastTrailDisplayTime = -1;

/**
 * Collision heatmap: a low-res (1/4 linear) density grid stamped with a Gaussian
 * kernel at every event impact point, multiplicatively faded each frame. Rendered
 * under the balls via an offscreen canvas upscaled bilinearly — gives the "where
 * does physics happen?" map without per-pixel work at canvas resolution.
 */
const HEATMAP_SCALE = 4;
const HEATMAP_W = Math.ceil(800 / HEATMAP_SCALE);
const HEATMAP_H = Math.ceil(560 / HEATMAP_SCALE);
const heatGrid = new Float32Array(HEATMAP_W * HEATMAP_H);
const heatCanvas: HTMLCanvasElement = document.createElement("canvas");
heatCanvas.width = HEATMAP_W;
heatCanvas.height = HEATMAP_H;
const heatCtx = heatCanvas.getContext("2d", { willReadFrequently: true })!;
const heatImageData = heatCtx.createImageData(HEATMAP_W, HEATMAP_H);
/** Per-particle collision-count snapshot from previous frame (for event detection). */
const prevCollisionCounts: number[] = [];
/** Gaussian kernel centered on impact cell — values chosen for a ~6-cell radius bloom. */
const HEAT_KERNEL_RADIUS = 4;
const HEAT_KERNEL: number[] = (() => {
  const k: number[] = [];
  const sigma = 1.8;
  for (let dy = -HEAT_KERNEL_RADIUS; dy <= HEAT_KERNEL_RADIUS; dy++) {
    for (let dx = -HEAT_KERNEL_RADIUS; dx <= HEAT_KERNEL_RADIUS; dx++) {
      k.push(Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma)));
    }
  }
  return k;
})();
const HEAT_DECAY = 0.985;
/** Drift a cell's color from cool→hot as density rises: blue → magenta → gold. */
function heatmapColor(t: number, out: Uint8ClampedArray, i: number): void {
  const k = Math.min(1, t);
  if (k < 1e-3) {
    out[i] = 0;
    out[i + 1] = 0;
    out[i + 2] = 0;
    out[i + 3] = 0;
    return;
  }
  const r = Math.min(255, 40 + 215 * k);
  const g = Math.min(255, 20 + 120 * k * k);
  const b = Math.min(255, 140 + 90 * (1 - k));
  out[i] = r;
  out[i + 1] = g;
  out[i + 2] = b;
  out[i + 3] = Math.min(220, 30 + 190 * k);
}

/**
 * Temperature field: a coarse (~20 px/cell) grid sampling weighted KE density
 * around each cell center. Produces a flowing hot/cold tint behind the balls so
 * you can see where energy is concentrated — especially useful at low restitution
 * (cold regions stay blue while hot pockets trail fast particles).
 */
const TEMP_CELL = 20;
const TEMP_W = Math.ceil(800 / TEMP_CELL);
const TEMP_H = Math.ceil(560 / TEMP_CELL);
const tempCanvas: HTMLCanvasElement = document.createElement("canvas");
tempCanvas.width = TEMP_W;
tempCanvas.height = TEMP_H;
const tempCtx = tempCanvas.getContext("2d")!;
const tempImageData = tempCtx.createImageData(TEMP_W, TEMP_H);
/** Gaussian falloff radius in px (≈ 2 cells). */
const TEMP_SIGMA = 70;
const TEMP_INV_2SIGMA2 = 1 / (2 * TEMP_SIGMA * TEMP_SIGMA);

let oracle: WasmOracle | undefined;
/** Cumulative applied-event count since boot (sums return of stepCollisions()). */
let totalAppliedEvents = 0;
/** Reference totals captured right after bootstrap for conservation drift readouts. */
let ke0 = 0;
let p0mag = 0;

/**
 * Maxwell's demon runtime state.
 *
 * - `toggleCount` / `infoBits`: each door state flip from the demon counts one
 *   bit of information erased from memory (Landauer-style bookkeeping). The
 *   strip-chart plots T_L vs T_R so you can see entropy sorting vs. information
 *   cost in real time.
 * - `gasEntropyBaseline`: S(system) computed right after a preset loads, using
 *   the 2D ideal-gas proxy S_side = N * ln(V_half * E_side / N²). ΔS_gas tracks
 *   the difference from this baseline.
 * - `stripHistory`: ring buffer of (T_L, T_R) samples, pushed ~every 120 ms.
 */
let toggleCount = 0;
let infoBits = 0;
let gasEntropyBaseline = 0;
const STRIP_HIST = 240;
type StripSample = { tL: number; tR: number };
const stripHistory: StripSample[] = [];
let lastStripPushWall = 0;
let lastDoorState = false;
let lastGapTop = 0;
let lastGapBot = 0;
let lastDividerActive = false;

let scene3d: Scene3D | undefined;
/** Display clock passed to Three.js for particle positions. */
let lastDisplayTimeFor3d = 0;

let prevOracleSim = -1;
let phaseStartWall = 0;
let phaseStartSim = 0;
let phaseEndSim = 0;
let heldAutoFrac = 0;

/**
 * Real-clock seconds per 1 unit of sim time. Each event-to-event phase is rendered
 * over `(phaseEndSim - phaseStartSim) * realSecondsPerSimSecond()` wall-clock seconds
 * so visual velocity is proportional to physical velocity (constant real-time motion),
 * instead of the old semantics where every phase took a fixed wall-clock duration
 * regardless of its sim-time span (which made dense collision clusters look slow and
 * long free-flights look fast).
 */
function realSecondsPerSimSecond(): number {
  const v = Number(sweepSlider.value);
  return v / 10;
}

function stepsPerFrame(): number {
  return Number(stepsSlider.value);
}

function syncStepsSweepLabels(): void {
  stepsVal.textContent = String(stepsSlider.value);
  sweepVal.textContent = `${(Number(sweepSlider.value) / 10).toFixed(1)}× s/s`;
}

function syncScrubLabelFromSlider(): void {
  const frac = Math.min(1, Math.max(0, Number(scrubSlider.value) / 1000));
  scrubVal.textContent = `${(frac * 100).toFixed(1)}%`;
}

stepsSlider.addEventListener("input", syncStepsSweepLabels);
sweepSlider.addEventListener("input", syncStepsSweepLabels);
scrubSlider.addEventListener("input", () => {
  scrubLock.checked = true;
  syncScrubLabelFromSlider();
});

syncStepsSweepLabels();
scrubVal.textContent = "0.0%";

function applyRestitution(): void {
  const e = Number(restiSlider.value) / 100;
  restiVal.textContent = e.toFixed(2);
  oracle?.setRestitution(e);
}

function applyGravity(): void {
  const gy = Number(gravityYSlider.value);
  gravityYVal.textContent = String(gy);
  oracle?.setGravity(0, gy, 0);
}

restiSlider.addEventListener("input", applyRestitution);
applyRestitution();

gravityYSlider.addEventListener("input", applyGravity);

space3dBox.addEventListener("change", () => {
  if (!oracle) {
    return;
  }
  if (space3dBox.checked) {
    const p3 = PRESETS.find((x) => x.id === "3d-mixed-box");
    if (p3) {
      loadPreset(p3);
    }
  } else {
    loadPreset(PRESETS[0]);
  }
});

torusModeBox.addEventListener("change", () => {
  if (!oracle) {
    return;
  }
  oracle.setTorusMode(torusModeBox.checked);
  trails.length = 0;
  lastTrailDisplayTime = -1;
  prevOracleSim = -1;
  clearHeatmap();
});

/**
 * Compute the gap bounds from a total-height slider value. Gap is centered
 * vertically; slider value is the total gap height in world pixels.
 */
function gapBoundsFromSlider(): { top: number; bot: number } {
  const gap = Math.max(10, Number(gapSlider.value));
  const midY = 0.5 * (bounds.minY + bounds.maxY);
  return { top: midY - gap * 0.5, bot: midY + gap * 0.5 };
}

function applyDividerGeometry(): void {
  if (!oracle) {
    return;
  }
  const { top, bot } = gapBoundsFromSlider();
  const xs = 0.5 * (bounds.minX + bounds.maxX);
  oracle.setDividerGeometry(xs, top, bot);
  lastGapTop = top;
  lastGapBot = bot;
}

function syncGapLabel(): void {
  gapVal.textContent = `${gapSlider.value}px`;
}

function syncDoorButton(): void {
  const open = oracle?.doorOpen ?? false;
  doorBtn.classList.toggle("is-open", open);
  doorBtn.textContent = open ? "Door: OPEN" : "Door: closed";
}

function toggleDoor(source: "user" | "demon"): void {
  if (!oracle || !oracle.dividerActive) {
    return;
  }
  const wasOpen = oracle.doorOpen;
  oracle.setDoorOpen(!wasOpen);
  if (source === "demon") {
    toggleCount += 1;
    infoBits = toggleCount;
  }
  syncDoorButton();
  prevOracleSim = -1;
}

dividerActiveBox.addEventListener("change", () => {
  if (!oracle) {
    return;
  }
  if (dividerActiveBox.checked) {
    applyDividerGeometry();
  }
  oracle.setDividerActive(dividerActiveBox.checked);
  lastDividerActive = dividerActiveBox.checked;
  trails.length = 0;
  lastTrailDisplayTime = -1;
  prevOracleSim = -1;
  syncDoorButton();
});

doorBtn.addEventListener("click", () => {
  toggleDoor("user");
});

gapSlider.addEventListener("input", () => {
  syncGapLabel();
  applyDividerGeometry();
});

syncGapLabel();

/**
 * Build one mass slider per particle once the engine is live. Each row shows the
 * particle's heatmap hue swatch (seeded color), a logarithmic-feel slider in
 * [0.25, 4.0] (so 1.0 sits mid-slider), and a live readout. Mass is written
 * directly into WASM heap (see WasmOracle.setMass) so pending pair events stay
 * valid — no heap purge, no velocity reset.
 */
function buildMassSliders(): void {
  if (!oracle) {
    return;
  }
  massRows.replaceChildren();
  const n = oracle.particleCount;
  for (let i = 0; i < n; i++) {
    const row = document.createElement("div");
    row.className = "mass-row";
    const baseHue = (i * 67) % 360;
    const swatch = document.createElement("span");
    swatch.className = "swatch";
    swatch.style.background = `hsl(${baseHue}, 95%, 60%)`;
    swatch.style.color = `hsl(${baseHue}, 95%, 60%)`;
    const label = document.createElement("span");
    label.textContent = `p${i}`;
    const slider = document.createElement("input");
    slider.type = "range";
    slider.min = "25";
    slider.max = "400";
    slider.step = "5";
    slider.value = String(Math.round(oracle.massAt(i) * 100));
    const val = document.createElement("span");
    val.className = "mass-val";
    const sync = () => {
      const m = Number(slider.value) / 100;
      val.textContent = `${m.toFixed(2)} kg`;
      oracle?.setMass(i, m);
    };
    slider.addEventListener("input", sync);
    sync();
    row.append(swatch, label, slider, val);
    massRows.appendChild(row);
  }
}

let activePresetId: string | null = null;

/** Reset conservation baselines to the engine's current state; triggers a pulse on the button. */
function resetBaseline(): void {
  if (!oracle) {
    return;
  }
  ke0 = oracle.totalKE();
  p0mag = oracle.totalMomentum().mag;
  gasEntropyBaseline = gasEntropy();
  toggleCount = 0;
  infoBits = 0;
  stripHistory.length = 0;
  resetBaselineBtn.classList.remove("pulse");
  void resetBaselineBtn.offsetWidth;
  resetBaselineBtn.classList.add("pulse");
}

function setXYOnlyControlsDisabled(disabled: boolean): void {
  viewHeatmap.disabled = disabled;
  viewTempField.disabled = disabled;
  viewTrails.disabled = disabled;
  viewGhosts.disabled = disabled;
  torusModeBox.disabled = disabled;
  demonPanel.classList.toggle("controls-disabled", disabled);
}

function syncSpaceVisualLayout(): void {
  if (!oracle) {
    return;
  }
  const on = oracle.spaceModeIsXYZ;
  space3dBox.checked = on;
  canvas.hidden = on;
  view3dWrap.hidden = !on;
  stripChart.hidden = on;
  stripLegend.hidden = on;
  setXYOnlyControlsDisabled(on);
  if (on) {
    if (!scene3d) {
      scene3d = new Scene3D({
        container: view3dWrap,
        bounds,
        maxParticles: MAX_PARTICLES,
        vMax,
        getOracle: () => oracle,
        getDisplayTime: () => lastDisplayTimeFor3d,
      });
    }
  } else {
    scene3d?.dispose();
    scene3d = undefined;
  }
}

/**
 * Reseed the engine from a preset: swap particle state in-place (no module teardown),
 * apply preset restitution, clear trails, reset event counter + baselines, and rebuild
 * the per-ball mass sliders since particle count may have changed.
 */
function loadPreset(preset: Preset): void {
  if (!oracle) {
    return;
  }
  const want3d = preset.space === "xyz";
  if (oracle.spaceModeIsXYZ !== want3d) {
    oracle.setSpaceMode(want3d);
  }
  space3dBox.checked = want3d;
  syncSpaceVisualLayout();

  oracle.reseed(preset.particles);
  restiSlider.value = String(Math.round(preset.restitution * 100));
  applyRestitution();

  if (want3d) {
    dividerActiveBox.checked = false;
    demonAutoBox.checked = false;
    oracle.setDividerActive(false);
  } else {
    const divCfg = preset.divider ?? { active: false, doorOpen: false, demonAuto: false };
    dividerActiveBox.checked = divCfg.active;
    demonAutoBox.checked = divCfg.demonAuto;
    if (divCfg.active) {
      applyDividerGeometry();
      oracle.setDividerActive(true);
      oracle.setDoorOpen(divCfg.doorOpen);
    } else {
      oracle.setDividerActive(false);
    }
  }
  lastDividerActive = oracle.dividerActive;
  lastDoorState = oracle.doorOpen;
  lastGapTop = oracle.gapTop;
  lastGapBot = oracle.gapBot;
  syncDoorButton();

  trails.length = 0;
  lastTrailDisplayTime = -1;
  totalAppliedEvents = 0;
  prevOracleSim = -1;
  heldAutoFrac = 0;
  toggleCount = 0;
  infoBits = 0;
  stripHistory.length = 0;
  lastStripPushWall = 0;
  clearHeatmap();
  ke0 = oracle.totalKE();
  p0mag = oracle.totalMomentum().mag;
  gasEntropyBaseline = gasEntropy();
  buildMassSliders();
  activePresetId = preset.id;
  presetDesc.textContent = preset.description;
  for (const el of presetList.querySelectorAll<HTMLButtonElement>(".preset-item")) {
    el.classList.toggle("active", el.dataset.presetId === preset.id);
  }
}

function buildPresetList(): void {
  presetList.replaceChildren();
  for (const preset of PRESETS) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "preset-item";
    btn.dataset.presetId = preset.id;
    const title = document.createElement("span");
    title.textContent = preset.name;
    const hint = document.createElement("span");
    hint.className = "preset-hint";
    const n = preset.particles.length;
    const tag = preset.space === "xyz" ? " · 3D" : "";
    hint.textContent = `N=${n} · e=${preset.restitution.toFixed(2)}${tag}`;
    btn.append(title, hint);
    btn.addEventListener("click", () => loadPreset(preset));
    if (preset.id === activePresetId) {
      btn.classList.add("active");
    }
    presetList.appendChild(btn);
  }
}

resetBaselineBtn.addEventListener("click", resetBaseline);

function keyboardTargetIsTextField(target: EventTarget | null): boolean {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  if (tag === "TEXTAREA") {
    return true;
  }
  if (tag === "SELECT") {
    return true;
  }
  if (tag === "INPUT") {
    const t = (target as HTMLInputElement).type;
    return (
      t === "text" ||
      t === "search" ||
      t === "email" ||
      t === "url" ||
      t === "password" ||
      t === "number" ||
      t === "tel"
    );
  }
  return false;
}

function adjustSweepSlider(deltaTenths: number): void {
  const min = Number(sweepSlider.min);
  const max = Number(sweepSlider.max);
  const next = Math.min(max, Math.max(min, Number(sweepSlider.value) + deltaTenths));
  sweepSlider.value = String(next);
  syncStepsSweepLabels();
}

window.addEventListener("keydown", (e: KeyboardEvent) => {
  if (keyboardTargetIsTextField(e.target)) {
    return;
  }
  if (e.code === "Space") {
    e.preventDefault();
    pauseSim.checked = !pauseSim.checked;
    return;
  }
  if (e.code === "ArrowLeft") {
    e.preventDefault();
    adjustSweepSlider(e.shiftKey ? -25 : -5);
    return;
  }
  if (e.code === "ArrowRight") {
    e.preventDefault();
    adjustSweepSlider(e.shiftKey ? 25 : 5);
    return;
  }
  if (e.code === "ArrowUp") {
    e.preventDefault();
    adjustSweepSlider(e.shiftKey ? 40 : 10);
    return;
  }
  if (e.code === "ArrowDown") {
    e.preventDefault();
    adjustSweepSlider(e.shiftKey ? -40 : -10);
    return;
  }
  if (e.code === "KeyG") {
    e.preventDefault();
    toggleDoor("user");
    return;
  }
});

function stampHeat(x: number, y: number, strength: number): void {
  const cx = Math.floor(x / HEATMAP_SCALE);
  const cy = Math.floor(y / HEATMAP_SCALE);
  let ki = 0;
  for (let dy = -HEAT_KERNEL_RADIUS; dy <= HEAT_KERNEL_RADIUS; dy++) {
    const gy = cy + dy;
    if (gy < 0 || gy >= HEATMAP_H) {
      ki += HEAT_KERNEL_RADIUS * 2 + 1;
      continue;
    }
    for (let dx = -HEAT_KERNEL_RADIUS; dx <= HEAT_KERNEL_RADIUS; dx++) {
      const gx = cx + dx;
      if (gx >= 0 && gx < HEATMAP_W) {
        heatGrid[gy * HEATMAP_W + gx] += HEAT_KERNEL[ki] * strength;
      }
      ki++;
    }
  }
}

/**
 * Detect which particles had their collision_count tick this frame and splat a
 * Gaussian at their current (post-resolve) position. Wall hits land on the arena
 * edge; pair hits produce two near-collocated stamps at the point of contact.
 * Strength scales with the particle's post-collision speed, so fast exchanges
 * burn brighter than slow bumps.
 */
function recordHeatEvents(displayTime: number): void {
  if (!oracle) {
    return;
  }
  const n = oracle.particleCount;
  while (prevCollisionCounts.length < n) {
    prevCollisionCounts.push(0);
  }
  for (let i = 0; i < n; i++) {
    const c = oracle.collisionCountAt(i);
    const prev = prevCollisionCounts[i];
    if (c > prev) {
      const pos = oracle.posAt(i, displayTime);
      const { vx, vy, vz } = oracle.velocityAt(i, displayTime);
      const speed = Math.hypot(vx, vy, vz);
      const strength = 0.6 + 1.4 * Math.min(1, speed / Math.max(1, vMax));
      const bumps = c - prev;
      for (let b = 0; b < bumps; b++) {
        stampHeat(pos.x, pos.y, strength);
      }
    }
    prevCollisionCounts[i] = c;
  }
  if (prevCollisionCounts.length > n) {
    prevCollisionCounts.length = n;
  }
}

function drawHeatmap(): void {
  if (!viewHeatmap.checked) {
    return;
  }
  const data = heatImageData.data;
  for (let i = 0, px = 0; i < heatGrid.length; i++, px += 4) {
    const v = heatGrid[i];
    heatmapColor(v, data, px);
    heatGrid[i] = v * HEAT_DECAY;
  }
  heatCtx.putImageData(heatImageData, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(heatCanvas, 0, 0, W, H);
  ctx.restore();
}

function clearHeatmap(): void {
  heatGrid.fill(0);
  prevCollisionCounts.length = 0;
}

/**
 * For each cell (TEMP_W × TEMP_H), sum `m·|v|² · exp(-d²/2σ²)` over all particles
 * using the cell-center sample point. Normalized by the peak cell value so the
 * palette stays legible regardless of absolute energy scale.
 */
function drawTemperatureField(displayTime: number): void {
  if (!viewTempField.checked || !oracle) {
    return;
  }
  const n = oracle.particleCount;
  if (n === 0) {
    return;
  }
  const pts: { x: number; y: number; ke: number }[] = [];
  for (let i = 0; i < n; i++) {
    const pos = oracle.posAt(i, displayTime);
    const { vx, vy, vz } = oracle.velocityAt(i, displayTime);
    const m = oracle.massAt(i);
    pts.push({ x: pos.x, y: pos.y, ke: 0.5 * m * (vx * vx + vy * vy + vz * vz) });
  }
  const cells = new Float32Array(TEMP_W * TEMP_H);
  let maxCell = 1e-6;
  for (let cy = 0; cy < TEMP_H; cy++) {
    const py = cy * TEMP_CELL + TEMP_CELL * 0.5;
    for (let cx = 0; cx < TEMP_W; cx++) {
      const px = cx * TEMP_CELL + TEMP_CELL * 0.5;
      let sum = 0;
      for (const p of pts) {
        const dx = p.x - px;
        const dy = p.y - py;
        sum += p.ke * Math.exp(-(dx * dx + dy * dy) * TEMP_INV_2SIGMA2);
      }
      cells[cy * TEMP_W + cx] = sum;
      if (sum > maxCell) {
        maxCell = sum;
      }
    }
  }
  const data = tempImageData.data;
  const inv = 1 / maxCell;
  for (let i = 0, px = 0; i < cells.length; i++, px += 4) {
    const t = Math.min(1, cells[i] * inv);
    if (t < 1e-3) {
      data[px] = 0;
      data[px + 1] = 0;
      data[px + 2] = 0;
      data[px + 3] = 0;
      continue;
    }
    // blue (cold) → cyan → green → yellow → red (hot)
    const hue = 230 - 230 * t;
    // HSL → RGB (quick manual conversion, s=0.75, l=0.5)
    const h = hue / 60;
    const c = 0.75;
    const xC = c * (1 - Math.abs((h % 2) - 1));
    let r = 0, g = 0, b = 0;
    if (h < 1) { r = c; g = xC; }
    else if (h < 2) { r = xC; g = c; }
    else if (h < 3) { g = c; b = xC; }
    else if (h < 4) { g = xC; b = c; }
    else if (h < 5) { r = xC; b = c; }
    else { r = c; b = xC; }
    const m = 0.5 - c * 0.5;
    data[px] = Math.round((r + m) * 255);
    data[px + 1] = Math.round((g + m) * 255);
    data[px + 2] = Math.round((b + m) * 255);
    data[px + 3] = Math.round(30 + 90 * t);
  }
  tempCtx.putImageData(tempImageData, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(tempCanvas, 0, 0, W, H);
  ctx.restore();
}

function drawBox(): void {
  ctx.save();
  ctx.strokeStyle = "#00d4ff";
  ctx.shadowColor = "#00d4ff";
  ctx.shadowBlur = 14;
  ctx.lineWidth = 2;
  if (torusModeBox.checked) {
    ctx.setLineDash([8, 8]);
    ctx.globalAlpha = 0.55;
  }
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  ctx.restore();
}

/**
 * Push a sample per active particle into its trail ring buffer. Skipped when the
 * display clock is frozen (paused / locked scrub and no advancement) to avoid
 * stacking duplicate points at the same spot.
 */
function updateTrails(displayTime: number): void {
  if (!oracle) {
    return;
  }
  if (Math.abs(displayTime - lastTrailDisplayTime) < 1e-9) {
    return;
  }
  lastTrailDisplayTime = displayTime;
  const n = oracle.particleCount;
  while (trails.length < n) {
    trails.push([]);
  }
  for (let i = 0; i < n; i++) {
    const pos = oracle.posAt(i, displayTime);
    const { vx, vy, vz } = oracle.velocityAt(i, displayTime);
    const speed = Math.hypot(vx, vy, vz);
    const t = vMax > 1e-9 ? Math.min(1, speed / vMax) : 0;
    const hue = 240 - t * 240;
    const buf = trails[i];
    buf.push({ x: pos.x, y: pos.y, hue });
    if (buf.length > TRAIL_LEN) {
      buf.shift();
    }
  }
}

/**
 * Render fading speed-colored streaks behind each particle. Uses additive blending
 * so overlapping passes glow. Segment alpha falls quadratically with age so the
 * freshest part is crisp and the tail dissolves cleanly.
 */
function drawTrails(): void {
  if (!oracle) {
    return;
  }
  const halfW = (bounds.maxX - bounds.minX) * 0.5;
  const halfH = (bounds.maxY - bounds.minY) * 0.5;
  const torus = torusModeBox.checked;
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  ctx.lineCap = "round";
  for (let i = 0; i < trails.length; i++) {
    const samples = trails[i];
    if (samples.length < 2) {
      continue;
    }
    const r = i < oracle.particleCount ? oracle.radiusAt(i) : 10;
    for (let k = 1; k < samples.length; k++) {
      const newness = k / samples.length;
      const alpha = 0.35 * newness * newness;
      if (alpha < 0.015) {
        continue;
      }
      const a = samples[k - 1];
      const b = samples[k];
      // Suppress trail segments that span a torus wrap (huge jump across arena).
      if (torus && (Math.abs(b.x - a.x) > halfW || Math.abs(b.y - a.y) > halfH)) {
        continue;
      }
      ctx.strokeStyle = `hsla(${b.hue}, 95%, 65%, ${alpha})`;
      ctx.lineWidth = Math.max(1, r * 0.45 * newness);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
  }
  ctx.restore();
}

/**
 * Speed heatmap: slow = electric blue (240°), fast = hot red (0°). Saturation is
 * pinned near 100% and a cyan/red shadow glow sells the neon feel against the dark
 * blue canvas. `vMax` is the initial-seed cap, so a mid-motion particle that gained
 * energy via mass exchange can clamp to t=1 (pure red) — that's the intended "hot"
 * readout.
 */
/** Returns up to 4 render positions for a particle: main + ghost wraps across torus seams. */
function torusRenderPositions(x: number, y: number, r: number): Array<{ x: number; y: number }> {
  if (!torusModeBox.checked) {
    return [{ x, y }];
  }
  const Wd = bounds.maxX - bounds.minX;
  const Hd = bounds.maxY - bounds.minY;
  const out: Array<{ x: number; y: number }> = [{ x, y }];
  const nearLeft = x - r < bounds.minX;
  const nearRight = x + r > bounds.maxX;
  const nearTop = y - r < bounds.minY;
  const nearBot = y + r > bounds.maxY;
  if (nearLeft) out.push({ x: x + Wd, y });
  if (nearRight) out.push({ x: x - Wd, y });
  if (nearTop) out.push({ x, y: y + Hd });
  if (nearBot) out.push({ x, y: y - Hd });
  if (nearLeft && nearTop) out.push({ x: x + Wd, y: y + Hd });
  if (nearRight && nearTop) out.push({ x: x - Wd, y: y + Hd });
  if (nearLeft && nearBot) out.push({ x: x + Wd, y: y - Hd });
  if (nearRight && nearBot) out.push({ x: x - Wd, y: y - Hd });
  return out;
}

function drawParticles(displayTime: number): void {
  const o = oracle!;
  const n = o.particleCount;
  for (let i = 0; i < n; i++) {
    const pos = o.posAt(i, displayTime);
    const r = o.radiusAt(i);
    const { vx, vy, vz } = o.velocityAt(i, displayTime);
    const speed = Math.hypot(vx, vy, vz);
    const t = vMax > 1e-9 ? Math.min(1, speed / vMax) : 0;
    const hue = 240 - t * 240;
    const fill = `hsl(${hue}, 95%, ${55 + t * 8}%)`;
    const rim = `hsla(${hue}, 100%, 88%, 0.75)`;
    for (const pt of torusRenderPositions(pos.x, pos.y, r)) {
      ctx.save();
      ctx.shadowColor = fill;
      ctx.shadowBlur = 14 + t * 12;
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, r, 0, Math.PI * 2);
      ctx.strokeStyle = rim;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
  }
}

/**
 * Trippy prediction trail: for every ball involved in the next queued event, paint a
 * chain of fading, shrinking, hue-rotating ghost copies along its future trajectory
 * from `displayTime` up to `eventTime`. Additive blending (`lighter`) gives the trail
 * a neon-glow feel that intensifies where ghosts overlap (e.g. right before impact).
 * Hue drifts in wall-clock time so the effect keeps breathing even while paused.
 */
const GHOSTS_PER_BALL = 14;

function drawNextEventGhosts(displayTime: number): void {
  const o = oracle!;
  const ev = o.peekNextEvent();
  if (!ev) {
    return;
  }
  const eventTime = ev.time;
  if (!(eventTime > displayTime)) {
    return;
  }
  const involved = ev.kind === "wall" ? [ev.particle] : [ev.a, ev.b];
  const wallPhase = performance.now() * 0.08;

  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const idx of involved) {
    const r = o.radiusAt(idx);
    const baseHue = (idx * 67) % 360;
    for (let k = 1; k <= GHOSTS_PER_BALL; k++) {
      const t = k / GHOSTS_PER_BALL;
      const gt = displayTime + t * (eventTime - displayTime);
      const pos = o.posAt(idx, gt);
      const alpha = 0.05 + 0.28 * (1 - t);
      const hue = (baseHue + t * 200 + wallPhase) % 360;
      const ghostR = r * (1 - 0.18 * t);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, ghostR, 0, Math.PI * 2);
      ctx.fillStyle = `hsla(${hue}, 95%, 62%, ${alpha})`;
      ctx.fill();
    }
    const impact = o.posAt(idx, eventTime);
    const pulse = 0.6 + 0.4 * Math.sin(wallPhase * 0.15);
    ctx.beginPath();
    ctx.arc(impact.x, impact.y, r * (1.15 + 0.25 * pulse), 0, Math.PI * 2);
    ctx.strokeStyle = `hsla(${(baseHue + 200 + wallPhase) % 360}, 100%, 70%, ${0.35 * pulse})`;
    ctx.lineWidth = 2;
    ctx.stroke();
  }
  ctx.restore();
}

function formatNext(ev: UiPeekEvent | undefined): string {
  if (!ev) return "—";
  if (ev.kind === "wall") return `wall@${ev.time.toFixed(4)}`;
  return `pair@${ev.time.toFixed(4)}`;
}

function formatEventDetail(e: UiHeapRow): string {
  return e.detail;
}

function refreshQueueTable(): void {
  const rows = oracle!.getQueuedEventsSorted(MAX_QUEUE_ROWS);
  queueBody.replaceChildren();
  const frag = document.createDocumentFragment();
  for (let i = 0; i < rows.length; i++) {
    const e = rows[i];
    const tr = document.createElement("tr");
    const tdN = document.createElement("td");
    const tdT = document.createElement("td");
    const tdK = document.createElement("td");
    const tdD = document.createElement("td");
    tdN.textContent = String(i + 1);
    tdT.textContent = e.time.toFixed(5);
    tdK.textContent = e.kind === "wall" ? "wall" : "pair";
    tdD.textContent = formatEventDetail(e);
    tr.append(tdN, tdT, tdK, tdD);
    frag.appendChild(tr);
  }
  queueBody.appendChild(frag);
}

/** Sweep / scrub clock along the current phase segment [phaseStartSim, phaseEndSim]. */
function computeFracAndDisplayTime(now: number): { frac: number; displayTime: number } {
  const span = Math.max(phaseEndSim - phaseStartSim, 1e-9);
  const segMs = span * realSecondsPerSimSecond() * 1000;
  let frac: number;
  if (scrubLock.checked) {
    frac = Number(scrubSlider.value) / 1000;
    frac = Math.min(1, Math.max(0, frac));
    scrubVal.textContent = `${(frac * 100).toFixed(1)}%`;
  } else if (pauseSim.checked) {
    frac = heldAutoFrac;
    scrubVal.textContent = `paused ${(frac * 100).toFixed(0)}%`;
    scrubSlider.value = String(Math.round(frac * 1000));
  } else {
    frac = segMs > 0 ? Math.min(1, (now - phaseStartWall) / segMs) : 1;
    heldAutoFrac = frac;
    scrubVal.textContent = `auto ${(frac * 100).toFixed(0)}%`;
    scrubSlider.value = String(Math.round(frac * 1000));
  }
  return { frac, displayTime: phaseStartSim + frac * span };
}

/**
 * 2D ideal-gas entropy proxy for one half: S_side = N * ln(V_half * E_side / N²)
 * (constants dropped). When N or E are zero we return 0 to keep ΔS finite — the
 * asymmetric empty-side limit isn't physically meaningful anyway.
 */
function halfEntropy(n: number, e: number, vHalf: number): number {
  if (n < 1 || e < 1e-9) {
    return 0;
  }
  return n * Math.log((vHalf * e) / (n * n));
}

function gasEntropy(): number {
  if (!oracle) {
    return 0;
  }
  const xs = oracle.dividerActive
    ? oracle.dividerX
    : 0.5 * (bounds.minX + bounds.maxX);
  const { nL, nR, keL, keR } = oracle.splitStats(xs);
  const innerW = bounds.maxX - bounds.minX;
  const innerH = bounds.maxY - bounds.minY;
  const vHalfL = innerH * (xs - bounds.minX);
  const vHalfR = innerH * (bounds.maxX - xs);
  return halfEntropy(nL, keL, vHalfL) + halfEntropy(nR, keR, vHalfR || innerH * innerW);
}

/**
 * Auto-demon: look for the particle that will soonest cross the divider through
 * the gap (if the door were open). If it's coming from the "wrong" side for its
 * speed, keep the door closed; if right side, open it. "Hot goes right, cold goes
 * left" via comparing the candidate's speed to the current ensemble mean. Each
 * state change costs 1 bit in the information ledger.
 */
function runAutoDemon(): void {
  if (!oracle || !demonAutoBox.checked || !oracle.dividerActive) {
    return;
  }
  const n = oracle.particleCount;
  if (n < 2) {
    return;
  }
  const xs = oracle.dividerX;
  const gTop = oracle.gapTop;
  const gBot = oracle.gapBot;
  const nowSim = oracle.sim_time;
  let meanKE = 0;
  const kes: number[] = [];
  for (let i = 0; i < n; i++) {
    const { vx, vy, vz } = oracle.velocityAt(i, nowSim);
    const ke = 0.5 * oracle.massAt(i) * (vx * vx + vy * vy + vz * vz);
    kes.push(ke);
    meanKE += ke;
  }
  meanKE /= n;

  let bestIdx = -1;
  let bestT = Infinity;
  let bestFromLeft = false;
  const horizon = 1.5;
  for (let i = 0; i < n; i++) {
    const pos = oracle.posAt(i, nowSim);
    const { vx } = oracle.velocityAt(i, nowSim);
    let tCross: number;
    const fromLeft = pos.x < xs;
    if (fromLeft && vx > 1e-6) {
      tCross = (xs - pos.x) / vx;
    } else if (!fromLeft && vx < -1e-6) {
      tCross = (xs - pos.x) / vx;
    } else {
      continue;
    }
    if (tCross <= 0 || tCross > horizon) {
      continue;
    }
    const yAt = oracle.posAt(i, nowSim + tCross).y;
    if (yAt < gTop || yAt > gBot) {
      continue;
    }
    if (tCross < bestT) {
      bestT = tCross;
      bestIdx = i;
      bestFromLeft = fromLeft;
    }
  }

  let desiredOpen: boolean;
  if (bestIdx < 0) {
    // No imminent gap-aligned approach — default to closed (demon is "sleeping").
    desiredOpen = false;
  } else {
    const hot = kes[bestIdx] > meanKE;
    desiredOpen = bestFromLeft ? hot : !hot;
  }
  if (desiredOpen !== oracle.doorOpen) {
    toggleDoor("demon");
  }
}

function pushStripSample(now: number): void {
  if (!oracle) {
    return;
  }
  if (now - lastStripPushWall < 120) {
    return;
  }
  lastStripPushWall = now;
  const xs = oracle.dividerActive
    ? oracle.dividerX
    : 0.5 * (bounds.minX + bounds.maxX);
  const { nL, nR, keL, keR } = oracle.splitStats(xs);
  // 2D: <E> = k_B T. We set k_B = 1, so T_side = E_side / N_side.
  const tL = nL > 0 ? keL / nL : 0;
  const tR = nR > 0 ? keR / nR : 0;
  stripHistory.push({ tL, tR });
  while (stripHistory.length > STRIP_HIST) {
    stripHistory.shift();
  }
}

function drawStripChart(): void {
  const w = stripChart.width;
  const h = stripChart.height;
  stripCtx.clearRect(0, 0, w, h);
  if (stripHistory.length < 2) {
    stripCtx.fillStyle = "rgba(110, 139, 184, 0.5)";
    stripCtx.font = "10px ui-sans-serif";
    stripCtx.fillText("temperature history — fills as simulation runs", 8, h / 2);
    return;
  }
  let maxT = 0;
  for (const s of stripHistory) {
    if (s.tL > maxT) maxT = s.tL;
    if (s.tR > maxT) maxT = s.tR;
  }
  if (maxT < 1e-9) {
    return;
  }
  const pad = 4;
  const plotW = w - pad * 2;
  const plotH = h - pad * 2;
  const dx = plotW / (STRIP_HIST - 1);
  const baseIdx = STRIP_HIST - stripHistory.length;

  stripCtx.strokeStyle = "rgba(110, 139, 184, 0.2)";
  stripCtx.lineWidth = 1;
  stripCtx.beginPath();
  stripCtx.moveTo(pad, pad + plotH * 0.5);
  stripCtx.lineTo(pad + plotW, pad + plotH * 0.5);
  stripCtx.stroke();

  const plotSeries = (
    key: "tL" | "tR",
    color: string,
  ): void => {
    stripCtx.strokeStyle = color;
    stripCtx.shadowColor = color;
    stripCtx.shadowBlur = 6;
    stripCtx.lineWidth = 1.5;
    stripCtx.beginPath();
    for (let i = 0; i < stripHistory.length; i++) {
      const x = pad + (baseIdx + i) * dx;
      const v = stripHistory[i][key];
      const y = pad + plotH * (1 - v / maxT);
      if (i === 0) {
        stripCtx.moveTo(x, y);
      } else {
        stripCtx.lineTo(x, y);
      }
    }
    stripCtx.stroke();
    stripCtx.shadowBlur = 0;
  };
  plotSeries("tL", "#60a5fa");
  plotSeries("tR", "#f472b6");

  stripCtx.strokeStyle = "rgba(250, 204, 21, 0.85)";
  stripCtx.lineWidth = 1;
  stripCtx.setLineDash([3, 3]);
  stripCtx.beginPath();
  for (let i = 0; i < stripHistory.length; i++) {
    const x = pad + (baseIdx + i) * dx;
    const diff = Math.abs(stripHistory[i].tL - stripHistory[i].tR);
    const y = pad + plotH * (1 - diff / maxT);
    if (i === 0) {
      stripCtx.moveTo(x, y);
    } else {
      stripCtx.lineTo(x, y);
    }
  }
  stripCtx.stroke();
  stripCtx.setLineDash([]);
}

function drawDivider(): void {
  if (!oracle || !oracle.dividerActive) {
    return;
  }
  const xs = oracle.dividerX;
  const gTop = oracle.gapTop;
  const gBot = oracle.gapBot;
  const open = oracle.doorOpen;
  ctx.save();
  ctx.strokeStyle = "#ff4d88";
  ctx.shadowColor = "#ff4d88";
  ctx.shadowBlur = 10;
  ctx.lineWidth = 3;
  ctx.lineCap = "round";

  ctx.beginPath();
  ctx.moveTo(xs, bounds.minY);
  ctx.lineTo(xs, gTop);
  ctx.moveTo(xs, gBot);
  ctx.lineTo(xs, bounds.maxY);
  ctx.stroke();

  if (open) {
    ctx.strokeStyle = "#4ade80";
    ctx.shadowColor = "#4ade80";
    ctx.lineWidth = 2;
    ctx.globalAlpha = 0.55;
    ctx.beginPath();
    ctx.moveTo(xs, gTop);
    ctx.lineTo(xs, gBot);
    ctx.stroke();
    ctx.globalAlpha = 1;
  } else {
    ctx.strokeStyle = "#ff4d88";
    ctx.globalAlpha = 0.35;
    ctx.setLineDash([4, 6]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(xs, gTop);
    ctx.lineTo(xs, gBot);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}

function updateDemonReadouts(): void {
  if (!oracle) {
    return;
  }
  const active = oracle.dividerActive;
  const xs = active ? oracle.dividerX : 0.5 * (bounds.minX + bounds.maxX);
  const { nL, nR, keL, keR } = oracle.splitStats(xs);
  const tL = nL > 0 ? keL / nL : 0;
  const tR = nR > 0 ? keR / nR : 0;
  statLEl.textContent = `N=${nL} · KE=${keL.toFixed(0)}`;
  statREl.textContent = `N=${nR} · KE=${keR.toFixed(0)}`;
  tLEl.textContent = `T_L=${tL > 0 ? tL.toFixed(0) : "—"}`;
  tREl.textContent = `T_R=${tR > 0 ? tR.toFixed(0) : "—"}`;
  const dS = gasEntropy() - gasEntropyBaseline;
  sGasEl.textContent = dS.toFixed(2);
  sInfoEl.textContent = String(infoBits);
  sTogglesEl.textContent = String(toggleCount);
}

/**
 * Choose a phase-end that stays ahead of `sim` (so `displayTime` can advance).
 * Only falls back when the engine truly has no valid future event; otherwise it
 * clamps to `sim + 1e-6` for same-time event clusters so they drain in one frame
 * instead of eating a 120 ms "dead wait" each time.
 */
function pickPhaseEnd(sim: number, nextT: number | null): number {
  if (nextT === null) {
    return sim + 0.12;
  }
  if (nextT > sim + 1e-9) {
    return nextT;
  }
  return sim + 1e-6;
}

function frame(now: number): void {
  syncStepsSweepLabels();

  if (!oracle) {
    return;
  }

  const simAtFrameStart = oracle.sim_time;
  if (scrubLock.checked || simAtFrameStart !== prevOracleSim) {
    oracle.purgeHeapPastSimTime();
  }
  if (simAtFrameStart !== prevOracleSim) {
    prevOracleSim = simAtFrameStart;
    phaseStartWall = now;
    phaseStartSim = simAtFrameStart;
    heldAutoFrac = 0;
    phaseEndSim = pickPhaseEnd(simAtFrameStart, oracle.peekNextTime());
    if (!scrubLock.checked) {
      scrubSlider.value = "0";
    }
  }

  let { displayTime } = computeFracAndDisplayTime(now);

  let appliedThisFrame = 0;
  if (!pauseSim.checked) {
    const maxBurst = Math.max(1, stepsPerFrame() * 8);
    let burst = 0;
    const eps = 1e-10;
    while (burst < maxBurst) {
      const simT = oracle.sim_time;
      if (displayTime <= simT + eps) {
        break;
      }
      const nextT = oracle.peekNextTime();
      if (nextT === null || nextT > displayTime + 1e-9) {
        break;
      }
      const applied = oracle.stepCollisions(1);
      totalAppliedEvents += applied;
      appliedThisFrame += applied;
      if (applied === 0) {
        break;
      }
      burst++;
    }
  }

  const sim = oracle.sim_time;
  if (scrubLock.checked || sim !== prevOracleSim) {
    oracle.purgeHeapPastSimTime();
  }
  // Phase reset triggers if sim_time advanced OR if events were applied this
  // frame without moving sim (multiple events at the same sim-time — otherwise
  // the second+ of them never triggers a reset and phaseEndSim stays stuck on
  // the stale sim + 0.12 fallback, freezing displayTime forever).
  let phaseResetAfterStep = false;
  if (sim !== prevOracleSim || appliedThisFrame > 0) {
    phaseResetAfterStep = true;
    prevOracleSim = sim;
    phaseStartWall = now;
    phaseStartSim = sim;
    heldAutoFrac = 0;
    phaseEndSim = pickPhaseEnd(sim, oracle.peekNextTime());
    if (!scrubLock.checked) {
      scrubSlider.value = "0";
    }
  } else {
    // No events this frame and sim unchanged, but a pending event may have
    // been added/removed elsewhere (mass tweak, preset load, restitution). Keep
    // phaseEndSim in sync so the sweep never undershoots or overshoots.
    const wanted = pickPhaseEnd(sim, oracle.peekNextTime());
    if (Math.abs(wanted - phaseEndSim) > 1e-9) {
      phaseEndSim = wanted;
    }
  }
  if (phaseResetAfterStep) {
    displayTime = computeFracAndDisplayTime(now).displayTime;
  }

  lastDisplayTimeFor3d = displayTime;
  const is3d = oracle.spaceModeIsXYZ;

  if (!is3d) {
    runAutoDemon();
    updateTrails(displayTime);
    recordHeatEvents(displayTime);

    ctx.clearRect(0, 0, W, H);
    drawBox();
    drawTemperatureField(displayTime);
    drawHeatmap();
    drawDivider();
    if (viewTrails.checked) {
      drawTrails();
    }
    drawParticles(displayTime);
    if (viewGhosts.checked) {
      drawNextEventGhosts(displayTime);
    }

    if (oracle.doorOpen !== lastDoorState) {
      lastDoorState = oracle.doorOpen;
      syncDoorButton();
    }
    if (oracle.dividerActive !== lastDividerActive) {
      lastDividerActive = oracle.dividerActive;
      dividerActiveBox.checked = lastDividerActive;
    }
    if (oracle.gapTop !== lastGapTop || oracle.gapBot !== lastGapBot) {
      lastGapTop = oracle.gapTop;
      lastGapBot = oracle.gapBot;
    }
    pushStripSample(now);
    updateDemonReadouts();
    drawStripChart();
  } else {
    scene3d?.frame();
  }

  const ke = oracle.totalKE();
  const mom = oracle.totalMomentum();
  const keRatio = ke0 > 1e-9 ? ke / ke0 : 1;
  const pRatio = p0mag > 1e-9 ? mom.mag / p0mag : mom.mag > 1e-9 ? Infinity : 1;
  const drift = (keRatio - 1) * 100;
  const driftColor =
    Math.abs(drift) < 0.01
      ? "#7df9ff"
      : Math.abs(drift) < 0.5
        ? "#ffcc66"
        : "#ff5a8a";
  const driftStr = `<span style="color:${driftColor}">${drift >= 0 ? "+" : ""}${drift.toFixed(3)}%</span>`;

  hud.innerHTML = [
    `sim_time: <strong>${sim.toFixed(4)}</strong>`,
    `display: <strong>${displayTime.toFixed(4)}</strong>`,
    `next: ${formatNext(oracle.peekNextEvent())}`,
    `heap: ${oracle.heapSize}`,
    `KE: <strong>${ke.toFixed(2)}</strong> (drift ${driftStr})`,
    `|p|: <strong>${mom.mag.toFixed(2)}</strong> (${(pRatio * 100).toFixed(2)}%)`,
    `events: <strong>${totalAppliedEvents}</strong>`,
    `incs: ${oracle.totalCollisionIncrements()}`,
  ].join(" · ");

  refreshQueueTable();

  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  try {
    oracle = await WasmOracle.create(MAX_PARTICLES, bounds, particleSeed);
    ke0 = oracle.totalKE();
    p0mag = oracle.totalMomentum().mag;
    gasEntropyBaseline = gasEntropy();
    applyRestitution();
    applyGravity();
    applyDividerGeometry();
    lastDividerActive = oracle.dividerActive;
    lastDoorState = oracle.doorOpen;
    lastGapTop = oracle.gapTop;
    lastGapBot = oracle.gapBot;
    syncDoorButton();
    buildMassSliders();
    activePresetId = "default";
    buildPresetList();
    presetDesc.textContent = PRESETS[0].description;
    space3dBox.checked = false;
    syncSpaceVisualLayout();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    hud.innerHTML = `<strong>WASM load failed.</strong> In the same terminal: <code>source /path/to/emsdk/emsdk_env.sh</code> then <code>npm run build:wasm</code> (see <code>native/README.md</code>).<br/><span style="opacity:0.9">${msg}</span>`;
    scrubVal.textContent = "—";
    return;
  }
  requestAnimationFrame(frame);
}

void boot().catch(() => {
  /* error HUD already set in boot */
});
