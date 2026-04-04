import type { Vec2 } from "./particle";

export const EPS = 1e-10;
export const TIME_EPS = 1e-7;

export interface AxisBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

function dot(a: Vec2, b: Vec2): number {
  return a.x * b.x + a.y * b.y;
}

function lenSq(v: Vec2): number {
  return dot(v, v);
}

/**
 * Smallest absolute time T > tMin such that p + v*(T - tRef) meets an axis-aligned inner boundary.
 * `p` is position at reference time `tRef`.
 */
export function earliestWallCollisionTime(
  p: Vec2,
  v: Vec2,
  r: number,
  b: AxisBounds,
  tRef: number,
  tMin: number,
): { t: number; wall: "left" | "right" | "bottom" | "top" } | null {
  let bestT = Infinity;
  let bestWall: "left" | "right" | "bottom" | "top" = "left";

  // Left: x(T) - r = minX  =>  T = tRef + (minX + r - p.x) / v.x
  if (v.x < -EPS) {
    const T = tRef + (b.minX + r - p.x) / v.x;
    if (T > tMin - TIME_EPS && T < bestT) {
      bestT = T;
      bestWall = "left";
    }
  }
  if (v.x > EPS) {
    const T = tRef + (b.maxX - r - p.x) / v.x;
    if (T > tMin - TIME_EPS && T < bestT) {
      bestT = T;
      bestWall = "right";
    }
  }
  // Canvas: y grows downward. Top edge = minY, bottom edge = maxY.
  if (v.y < -EPS) {
    const T = tRef + (b.minY + r - p.y) / v.y;
    if (T > tMin - TIME_EPS && T < bestT) {
      bestT = T;
      bestWall = "top";
    }
  }
  if (v.y > EPS) {
    const T = tRef + (b.maxY - r - p.y) / v.y;
    if (T > tMin - TIME_EPS && T < bestT) {
      bestT = T;
      bestWall = "bottom";
    }
  }

  if (!Number.isFinite(bestT) || bestT >= Infinity) return null;
  return { t: bestT, wall: bestWall };
}

/**
 * Earliest absolute time T > tRef where ||(p2-p1) + (v2-v1)*(T-tRef)|| = r1+r2.
 * Positions p1,p2 and velocities are at the same reference instant tRef.
 */
export function earliestPairCollisionTime(
  p1: Vec2,
  v1: Vec2,
  r1: number,
  p2: Vec2,
  v2: Vec2,
  r2: number,
  tRef: number,
  tMin: number,
): number | null {
  const P: Vec2 = { x: p2.x - p1.x, y: p2.y - p1.y };
  const V: Vec2 = { x: v2.x - v1.x, y: v2.y - v1.y };
  const R = r1 + r2;
  const R2 = R * R;

  const a = lenSq(V);
  const b = 2 * dot(P, V);
  const c = lenSq(P) - R2;

  let dt: number | null = null;

  if (a < EPS) {
    // Parallel motion: |P + V*dt|^2 = R2 with V ~ 0 → check distance constant
    if (Math.abs(b) < EPS) {
      if (Math.abs(c) < EPS * R2) {
        // Coincident centers — ignore (degenerate)
        return null;
      }
      return null;
    }
    // Linear: b*dt + c = 0 (from 2*P·V*dt + c = 0 when a=0)
    const root = -c / b;
    if (root > tMin - tRef - TIME_EPS && root < Infinity) dt = root;
  } else {
    const disc = b * b - 4 * a * c;
    if (disc < -EPS) return null;
    const sqrtD = disc <= 0 ? 0 : Math.sqrt(disc);
    const t1 = (-b - sqrtD) / (2 * a);
    const t2 = (-b + sqrtD) / (2 * a);
    const candidates = [t1, t2].filter((x) => x > tMin - tRef - TIME_EPS && Number.isFinite(x));
    if (candidates.length === 0) return null;
    dt = Math.min(...candidates);
  }

  if (dt === null || dt < TIME_EPS) return null;
  const T = tRef + dt;
  if (T < tMin - TIME_EPS) return null;
  return T;
}

export function normalize(v: Vec2): Vec2 {
  const L = Math.sqrt(lenSq(v));
  if (L < EPS) return { x: 1, y: 0 };
  return { x: v.x / L, y: v.y / L };
}

/** Elastic collision impulse along n (from a toward b); updates velocities in place. */
export function resolveElasticPair(
  a: { velocity: Vec2; mass: number },
  b: { velocity: Vec2; mass: number },
  n: Vec2,
  restitution = 1,
): void {
  const rvx = a.velocity.x - b.velocity.x;
  const rvy = a.velocity.y - b.velocity.y;
  const velAlongN = rvx * n.x + rvy * n.y;
  if (velAlongN >= -EPS) return;

  const invMassSum = 1 / a.mass + 1 / b.mass;
  const j = -(1 + restitution) * velAlongN / invMassSum;
  const jx = j * n.x;
  const jy = j * n.y;
  a.velocity.x += jx / a.mass;
  a.velocity.y += jy / a.mass;
  b.velocity.x -= jx / b.mass;
  b.velocity.y -= jy / b.mass;
}
