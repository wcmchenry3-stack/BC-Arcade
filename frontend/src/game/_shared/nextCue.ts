/**
 * Background-music starting points (#3638, epic #3635): the starting point to save when the
 * player leaves, so the next visit opens somewhere new.
 *
 * Returns the first cue strictly after `positionMs`, or 0 (0:00) when the position is at or past
 * the last cue, so the soundtrack wraps round. Invalid input (an empty or non-numeric cue list, a
 * negative or non-finite position) gives 0. Cues need not be sorted; negative or non-finite cues
 * are ignored. Pure, so Mahjong's music can reuse it.
 */
export function nextCue(positionMs: number, cuesMs: readonly number[]): number {
  if (!Number.isFinite(positionMs) || positionMs < 0) return 0;
  let next = Infinity;
  for (const cue of cuesMs) {
    if (Number.isFinite(cue) && cue >= 0 && cue > positionMs && cue < next) next = cue;
  }
  return next === Infinity ? 0 : next;
}
