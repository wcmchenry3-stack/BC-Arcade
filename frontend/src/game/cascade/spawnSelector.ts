/**
 * The spawner (#3697; weights #3904, owner pick "V1"). Which tier the queue offers next, by
 * weight: base weights, a drought boost for a tier not seen lately, a danger mode when the pile is
 * near the lid, and an anti-streak ban. The numbers make the win reachable in a session: tiers
 * 0-7 drop, weighted 2 3 3 3 3 3 2 1, so a drop carries about 22.2 tier-0 pieces' worth of
 * material on average and the win (two capstones, 2 x 2048 of them) is about 185 perfect drops
 * away. See docs/games/cascade.md.
 */
import { DROPPABLE_PIECE_TIERS } from "./pieceDefs";

const BASE_WEIGHTS: Record<number, number> = {
  0: 2,
  1: 3,
  2: 3,
  3: 3,
  4: 3,
  5: 3,
  6: 2,
  7: 1,
};

export const DROUGHT_WINDOW = 10;
const DROUGHT_BOOST = 3;
const STREAK_WINDOW = 4;
/**
 * In danger, tiers at or above this are scaled by DANGER_PENALTY (min weight 1). #3904 removed
 * #3697's second danger rule, which also multiplied the tiers below it by 1.5: on the V1 ladder
 * that stream of small pieces was what kept a mashing player's pile hovering just under the lid
 * (the spam bot outlived the 120 s lid bound), while a careful player is in danger for about
 * 10 % of its drops and only at the end of a lost game. See docs/games/cascade.md.
 */
const DANGER_TIER_THRESHOLD = 3;
const DANGER_PENALTY = 0.2;

export function selectNextTier(
  history: number[],
  isInDanger: boolean,
  rng: () => number = Math.random
): number {
  const weights: Record<number, number> = { ...BASE_WEIGHTS };

  // Drought correction: boost tiers absent from the last DROUGHT_WINDOW drops
  const recentDrops = history.slice(-DROUGHT_WINDOW);
  for (const tier of DROPPABLE_PIECE_TIERS) {
    if (!recentDrops.includes(tier)) {
      weights[tier] = (weights[tier] ?? 0) + DROUGHT_BOOST;
    }
  }

  // Danger state: suppress large (high-tier) pieces when the stack is high.
  if (isInDanger) {
    for (const tier of DROPPABLE_PIECE_TIERS) {
      if (tier >= DANGER_TIER_THRESHOLD) {
        weights[tier] = Math.max(1, Math.round((weights[tier] ?? 1) * DANGER_PENALTY));
      }
    }
  }

  // Anti-streak: hard-ban a tier that filled the last STREAK_WINDOW slots.
  // Applied after drought and danger so neither can rescue the banned tier,
  // guaranteeing at most STREAK_WINDOW consecutive identical picks.
  if (history.length >= STREAK_WINDOW) {
    const tail = history.slice(-STREAK_WINDOW);
    const streakTier = tail[0];
    if (streakTier !== undefined && tail.every((t) => t === streakTier)) {
      weights[streakTier] = 0;
    }
  }

  const total = DROPPABLE_PIECE_TIERS.reduce((s, t) => s + (weights[t] ?? 0), 0);
  let rand = rng() * total;
  for (const tier of DROPPABLE_PIECE_TIERS) {
    rand -= weights[tier] ?? 0;
    if (rand <= 0) return tier;
  }
  return DROPPABLE_PIECE_TIERS[DROPPABLE_PIECE_TIERS.length - 1] ?? 0;
}
