import { DROPPABLE_PIECE_TIERS } from "./pieceDefs";

const BASE_WEIGHTS: Record<number, number> = { 0: 5, 1: 4, 2: 3, 3: 2, 4: 1 };

const DROUGHT_WINDOW = 10;
const DROUGHT_BOOST = 3;
const STREAK_WINDOW = 3;
const STREAK_PENALTY = 0.3;
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

  // Anti-streak: penalise a tier that filled the last STREAK_WINDOW slots
  if (history.length >= STREAK_WINDOW) {
    const tail = history.slice(-STREAK_WINDOW);
    const streakTier = tail[0];
    if (streakTier !== undefined && tail.every((t) => t === streakTier)) {
      weights[streakTier] = Math.max(1, Math.round((weights[streakTier] ?? 1) * STREAK_PENALTY));
    }
  }

  // Danger state: suppress large (high-tier) pieces when stack is high
  if (isInDanger) {
    for (const tier of DROPPABLE_PIECE_TIERS) {
      if (tier >= DANGER_TIER_THRESHOLD) {
        weights[tier] = Math.max(1, Math.round((weights[tier] ?? 1) * DANGER_PENALTY));
      }
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
