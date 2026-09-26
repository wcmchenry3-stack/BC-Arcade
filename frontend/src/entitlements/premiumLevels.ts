/**
 * Difficulty levels that belong to BC Arcade Premium (#1129).
 *
 * Premium is per game today (`PREMIUM_GAMES` in `EntitlementContext.tsx`).
 * This is the per-level counterpart: a game's picker shows a listed level
 * with a lock, and tapping it explains that the level is part of Premium
 * rather than starting it. A remembered last difficulty that is now locked
 * is ignored.
 *
 * No level is locked yet. There is nothing to buy until IAP lands
 * (epic #822), so the notice says "coming soon" and no entitlement unlocks a
 * listed level. When IAP lands, gate `isPremiumLevel` on the entitlement.
 */

/** Game key → the premium levels of that game. Empty until a level is listed. */
const PREMIUM_LEVELS: Readonly<Record<string, readonly string[]>> = {};

let overrides: Readonly<Record<string, readonly string[]>> | null = null;

/** True when `level` of `gameKey` is a premium level the player can't start. */
export function isPremiumLevel(gameKey: string, level: string): boolean {
  const levels = (overrides ?? PREMIUM_LEVELS)[gameKey];
  return levels !== undefined && levels.includes(level);
}

/** Test seam: replaces the premium levels. Pass null to restore them. */
export function __setPremiumLevelsForTests(
  levels: Readonly<Record<string, readonly string[]>> | null
): void {
  overrides = levels;
}
