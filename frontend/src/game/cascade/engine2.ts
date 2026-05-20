// Stub — types only. Implementation lands in #1750.

export interface EngineConfig {
  worldWidth?: number;
  worldHeight?: number;
}

export interface PieceState {
  tier: number;
  x: number;
  y: number;
}

export interface GameState {
  pieces: PieceState[];
  score: number;
  gameOver: boolean;
}

export type EngineEvent =
  | { type: "merge"; tierA: number; tierB: number; result: number }
  | { type: "gameOver" }
  | { type: "guardRailFired" };

export interface StepResult {
  events: EngineEvent[];
}

export class CascadeEngine {
  constructor(_config: EngineConfig = {}) {
    throw new Error("CascadeEngine: not yet implemented — see #1750");
  }

  getState(): GameState {
    throw new Error("not implemented");
  }

  drop(_tier: number, _x: number): void {
    throw new Error("not implemented");
  }

  step(_dtMs: number): StepResult {
    throw new Error("not implemented");
  }
}
