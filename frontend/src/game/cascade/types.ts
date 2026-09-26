/**
 * Cascade event types.
 */

export type GameEvent =
  | { readonly type: "fruitMerge"; readonly tier: number; readonly x: number; readonly y: number }
  | { readonly type: "cascadeCombo"; readonly count: number }
  | { readonly type: "gameOver" };
