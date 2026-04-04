import type { AxisBounds } from "./collision-math";
import {
  earliestPairCollisionTime,
  earliestWallCollisionTime,
  normalize,
  resolveElasticPair,
  TIME_EPS,
} from "./collision-math";
import type { SimEvent } from "./event";
import { MinHeap } from "./heap";
import type { Particle } from "./particle";

function validateEvent(e: SimEvent): boolean {
  if (e.kind === "wall") {
    return e.countA === e.particle.collision_count;
  }
  return e.countA === e.a.collision_count && e.countB === e.b.collision_count;
}

export class Oracle {
  sim_time = 0;
  readonly particles: Particle[];
  readonly bounds: AxisBounds;
  private readonly heap = new MinHeap<SimEvent>((ev) => ev.time);

  constructor(particles: Particle[], bounds: AxisBounds) {
    this.particles = particles;
    this.bounds = bounds;
  }

  get heapSize(): number {
    return this.heap.size;
  }

  peekNextEvent(): SimEvent | undefined {
    return this.heap.peek();
  }

  peekNextTime(): number | null {
    const e = this.heap.peek();
    return e ? e.time : null;
  }

  /** All queued events sorted by time (includes ghosts until popped). */
  getQueuedEventsSorted(): SimEvent[] {
    return this.heap.snapshotSorted();
  }

  /** Advance all particles to absolute time `t` (kinematic state at sim jump). */
  integrateAll(t: number): void {
    for (const p of this.particles) {
      const pt = p.pos_at(t);
      p.position.x = pt.x;
      p.position.y = pt.y;
      p.lastUpdateTime = t;
    }
  }

  predictPair(a: Particle, b: Particle): void {
    if (a === b) return;
    const t0 = this.sim_time;
    const pa = a.pos_at(t0);
    const pb = b.pos_at(t0);
    const T = earliestPairCollisionTime(
      pa,
      a.velocity,
      a.radius,
      pb,
      b.velocity,
      b.radius,
      t0,
      t0 + TIME_EPS,
    );
    if (T === null || !Number.isFinite(T)) return;
    this.heap.push({
      kind: "pair",
      time: T,
      a,
      b,
      countA: a.collision_count,
      countB: b.collision_count,
    });
  }

  predictWall(p: Particle): void {
    const t0 = this.sim_time;
    const pos = p.pos_at(t0);
    const hit = earliestWallCollisionTime(
      pos,
      p.velocity,
      p.radius,
      this.bounds,
      t0,
      t0 + TIME_EPS,
    );
    if (hit === null) return;
    this.heap.push({
      kind: "wall",
      time: hit.t,
      particle: p,
      wall: hit.wall,
      countA: p.collision_count,
    });
  }

  /** Full O(n²) prediction — startup or hard reset. */
  predictAll(): void {
    const n = this.particles.length;
    for (let i = 0; i < n; i++) {
      this.predictWall(this.particles[i]);
      for (let j = i + 1; j < n; j++) {
        this.predictPair(this.particles[i], this.particles[j]);
      }
    }
  }

  /** After collisions involving `involved`, reschedule their wall and pair events. */
  repredictInvolved(involved: Particle[]): void {
    const set = new Set(involved);
    const n = this.particles.length;
    for (let i = 0; i < n; i++) {
      const pi = this.particles[i];
      if (!set.has(pi)) continue;
      this.predictWall(pi);
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        this.predictPair(pi, this.particles[j]);
      }
    }
  }

  private resolveWall(e: Extract<SimEvent, { kind: "wall" }>): void {
    const p = e.particle;
    switch (e.wall) {
      case "left":
      case "right":
        p.velocity.x = -p.velocity.x;
        break;
      case "bottom":
      case "top":
        p.velocity.y = -p.velocity.y;
        break;
    }
    p.collision_count++;
  }

  private resolvePair(e: Extract<SimEvent, { kind: "pair" }>): void {
    const { a, b } = e;
    const pa = a.pos_at(this.sim_time);
    const pb = b.pos_at(this.sim_time);
    const n = normalize({ x: pb.x - pa.x, y: pb.y - pa.y });
    resolveElasticPair(a, b, n, 1);
    a.collision_count++;
    b.collision_count++;
  }

  /**
   * Pop ghost events until one validates; integrate, resolve, repredict.
   * Returns false if heap empty.
   */
  processNextCollision(): boolean {
    while (!this.heap.isEmpty()) {
      const e = this.heap.pop()!;
      if (!validateEvent(e)) continue;

      this.integrateAll(e.time);
      this.sim_time = e.time;

      if (e.kind === "wall") {
        this.resolveWall(e);
        this.repredictInvolved([e.particle]);
      } else {
        this.resolvePair(e);
        this.repredictInvolved([e.a, e.b]);
      }
      return true;
    }
    return false;
  }

  /** Run up to `maxSteps` validated collisions (for frame budget). */
  stepCollisions(maxSteps: number): number {
    let done = 0;
    while (done < maxSteps && this.processNextCollision()) {
      done++;
    }
    return done;
  }
}
