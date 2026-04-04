import type { Particle } from "./particle";

export type WallAxis = "left" | "right" | "bottom" | "top";

export type SimEvent =
  | {
      kind: "pair";
      time: number;
      a: Particle;
      b: Particle;
      countA: number;
      countB: number;
    }
  | {
      kind: "wall";
      time: number;
      particle: Particle;
      wall: WallAxis;
      countA: number;
    };
