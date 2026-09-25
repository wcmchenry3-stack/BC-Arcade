/**
 * Cascade session and event types.
 */

import type { GameSession } from "../_shared/types";

// Cascade maintains no server-side game state during play;
// gameplay is frontend-only. Session is used for lifecycle tracking only.
export type CascadeSession = GameSession<null>;

export type GameEvent =
  | { readonly type: "fruitMerge"; readonly tier: number; readonly x: number; readonly y: number }
  | { readonly type: "cascadeCombo"; readonly count: number }
  | { readonly type: "gameOver" };
