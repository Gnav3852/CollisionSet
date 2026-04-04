import type { UiHeapRow, UiPeekEvent } from "./oracleWasm";
import { WasmOracle } from "./oracleWasm";

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

const ctx = canvas.getContext("2d")!;

const W = canvas.width;
const H = canvas.height;
const padding = 24;
const bounds = {
  minX: padding,
  maxX: W - padding,
  minY: padding,
  maxY: H - padding,
};

/** ~4 s to cross inner box width at max initial speed (atmospheric drift). */
const innerWidth = bounds.maxX - bounds.minX;
const vMax = innerWidth / 4;
const rawVel = [
  { vx: 200, vy: 60 },
  { vx: -190, vy: -40 },
] as const;
let maxSpeed = 0;
for (const v of rawVel) {
  maxSpeed = Math.max(maxSpeed, Math.hypot(v.vx, v.vy));
}
const vScale = maxSpeed > 0 ? vMax / maxSpeed : 1;
const particleSeed = [
  { x: 160, y: 280, vx: rawVel[0].vx * vScale, vy: rawVel[0].vy * vScale, radius: 22, mass: 1 },
  { x: 640, y: 300, vx: rawVel[1].vx * vScale, vy: rawVel[1].vy * vScale, radius: 22, mass: 1 },
];

const MAX_QUEUE_ROWS = 40;
const MAX_PARTICLES = 8;

let oracle: WasmOracle | undefined;

let prevOracleSim = -1;
let phaseStartWall = 0;
let phaseStartSim = 0;
let phaseEndSim = 0;
let heldAutoFrac = 0;

function sweepSeconds(): number {
  const v = Number(sweepSlider.value);
  return v / 10;
}

function stepsPerFrame(): number {
  return Number(stepsSlider.value);
}

/** Slider value labels must update even before WASM boots (frame() not running yet). */
function syncStepsSweepLabels(): void {
  stepsVal.textContent = String(stepsSlider.value);
  sweepVal.textContent = `${(Number(sweepSlider.value) / 10).toFixed(1)}s`;
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
});

function drawBox(): void {
  ctx.strokeStyle = "#3d4a5c";
  ctx.lineWidth = 2;
  ctx.strokeRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
}

function drawParticles(displayTime: number): void {
  const o = oracle!;
  const n = o.particleCount;
  for (let i = 0; i < n; i++) {
    const pos = o.posAt(i, displayTime);
    const r = o.radiusAt(i);
    const { vx, vy } = o.velocityAt(i);
    const speed = Math.hypot(vx, vy);
    const t = vMax > 1e-9 ? Math.min(1, speed / vMax) : 0;
    const light = 38 + t * 32;
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
    ctx.fillStyle = `hsl(${(i * 67) % 360} 58% ${light}%)`;
    ctx.fill();
    ctx.strokeStyle = "rgba(0,0,0,0.25)";
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

/** One segment from oracle state at sim_time to next valid impact (engine-derived). */
function drawCausality(simTime: number): void {
  const o = oracle!;
  const ev = o.peekNextEvent();
  const impact = o.peekNextImpact();
  if (!ev || !impact) {
    return;
  }
  let fx: number;
  let fy: number;
  if (ev.kind === "wall") {
    const p = o.posAt(ev.particle, simTime);
    fx = p.x;
    fy = p.y;
  } else {
    const pa = o.posAt(ev.a, simTime);
    const pb = o.posAt(ev.b, simTime);
    fx = 0.5 * (pa.x + pb.x);
    fy = 0.5 * (pa.y + pb.y);
  }
  ctx.beginPath();
  ctx.moveTo(fx, fy);
  ctx.lineTo(impact.x, impact.y);
  ctx.strokeStyle = "rgba(200, 220, 255, 0.45)";
  ctx.lineWidth = 1.5;
  ctx.stroke();
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
  const segMs = sweepSeconds() * 1000;
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
    const next = oracle.peekNextTime();
    phaseEndSim =
      next !== null && next > simAtFrameStart + 1e-9 ? next : simAtFrameStart + 0.12;
    if (!scrubLock.checked) {
      scrubSlider.value = "0";
    }
  }

  let { displayTime } = computeFracAndDisplayTime(now);

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
      oracle.stepCollisions(1);
      burst++;
    }
  }

  const sim = oracle.sim_time;
  if (scrubLock.checked || sim !== prevOracleSim) {
    oracle.purgeHeapPastSimTime();
  }
  let phaseResetAfterStep = false;
  if (sim !== prevOracleSim) {
    phaseResetAfterStep = true;
    prevOracleSim = sim;
    phaseStartWall = now;
    phaseStartSim = sim;
    heldAutoFrac = 0;
    const next = oracle.peekNextTime();
    phaseEndSim = next !== null && next > sim + 1e-9 ? next : sim + 0.12;
    if (!scrubLock.checked) {
      scrubSlider.value = "0";
    }
  }
  if (phaseResetAfterStep) {
    displayTime = computeFracAndDisplayTime(now).displayTime;
  }

  ctx.clearRect(0, 0, W, H);
  drawBox();
  drawParticles(displayTime);
  drawCausality(sim);

  hud.innerHTML = [
    `sim_time: <strong>${sim.toFixed(4)}</strong>`,
    `display: <strong>${displayTime.toFixed(4)}</strong>`,
    `next: ${formatNext(oracle.peekNextEvent())}`,
    `heap: ${oracle.heapSize}`,
    `· lockstep · C++ WASM`,
  ].join(" · ");

  refreshQueueTable();

  requestAnimationFrame(frame);
}

async function boot(): Promise<void> {
  try {
    oracle = await WasmOracle.create(MAX_PARTICLES, bounds, particleSeed);
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
