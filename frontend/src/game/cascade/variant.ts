/**
 * #3904 proposals (scratch branch only, never merged): a ladder / difficulty / room variant
 * read once at import time from `process.env.CASCADE_VARIANT` (JSON), so the sim harness can
 * play the real engine with a candidate tuning in a separate process. Unset = today's game.
 *
 * Fields:
 *   - r0, k: constant-ratio ladder r_n = r0 * k^n for every tier 0..11 (not rounded, so every
 *     tier-to-tier ratio is exactly k).
 *   - maxDrop: highest droppable tier; weights: base spawn weight per droppable tier.
 *   - wall: wall thickness (the bin's inner faces at x = wall and 400 - wall).
 *   - pairWin: two touching capstones resolve into the win (both removed, `win` emitted);
 *     making the capstone is no longer the win.
 */
export interface CascadeVariant {
  name: string;
  r0: number;
  k: number;
  maxDrop: number;
  weights: number[];
  wall: number;
  pairWin: boolean;
}

function read(): CascadeVariant | null {
  const raw = typeof process !== "undefined" ? process.env?.CASCADE_VARIANT : undefined;
  if (!raw) return null;
  return JSON.parse(raw) as CascadeVariant;
}

export const VARIANT: CascadeVariant | null = read();
