/**
 * #3920 proposals (scratch branch only, never merged): a ladder / spawn variant read once at
 * import time from `process.env.CASCADE_VARIANT` (JSON), so the sim harness can play the real
 * engine with a candidate tuning in a separate process. Unset = today's game (V1, #3904).
 *
 * Fields:
 *   - r0, r11: constant-ratio ladder r_n = r0 * k^n, k = (r11 / r0)^(1/11), unrounded.
 *   - maxDrop: highest droppable tier; weights: base spawn weight per droppable tier (0..maxDrop).
 *   - dangerFrom: in danger, tiers dangerFrom..maxDrop-1 are scaled by dangerPenalty and the
 *     top droppable tier by dangerTop (V1: 3, 0.2, 0.35).
 */
export interface CascadeVariant {
  name: string;
  r0: number;
  r11: number;
  maxDrop: number;
  weights: number[];
  dangerFrom: number;
  dangerPenalty: number;
  dangerTop: number;
}

function read(): CascadeVariant | null {
  const raw = typeof process !== "undefined" ? process.env?.CASCADE_VARIANT : undefined;
  if (!raw) return null;
  return JSON.parse(raw) as CascadeVariant;
}

export const VARIANT: CascadeVariant | null = read();
