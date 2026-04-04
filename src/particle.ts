export interface Vec2 {
  x: number;
  y: number;
}

export class Particle {
  readonly id: number;
  position: Vec2;
  velocity: Vec2;
  radius: number;
  mass: number;
  collision_count = 0;
  lastUpdateTime = 0;

  constructor(
    id: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    radius: number,
    mass: number,
  ) {
    this.id = id;
    this.position = { x, y };
    this.velocity = { x: vx, y: vy };
    this.radius = radius;
    this.mass = mass;
  }

  /** Linear motion from lastUpdateTime: P(t) = P_ref + V * (t - t_ref). */
  pos_at(t: number): Vec2 {
    const dt = t - this.lastUpdateTime;
    return {
      x: this.position.x + this.velocity.x * dt,
      y: this.position.y + this.velocity.y * dt,
    };
  }
}
