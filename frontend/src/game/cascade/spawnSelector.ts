/**
 * The spawner (#3697; weights #3920, retuned #3967). Which tier the queue offers next, by
 * weight: base weights, a drought boost for a tier not seen lately, a danger mode when the pile is
 * near the lid, and an anti-streak ban. The numbers make the win reachable in a session: tiers
 * 0-5 drop, weighted 1 1 2 3 4 4 (#3967, for the 12-tier ladder of #3960; #3920's 11 tiers were
 * 2 3 3 3 2 1, 7.7 tier-0 pieces a drop), so a drop carries about 15 tier-0 pieces' worth of
 * material on average and the win (one capstone, 2048 of them) is about 135 perfect drops away,
 * as on the 11-tier ladder. Each trial of the retune: docs/games/cascade-decisions.md
 * (Piece Queue & Spawn Selection) and docs/games/cascade.md.
 */
import { DROPPABLE_PIECE_TIERS } from "./pieceDefs";

const BASE_WEIGHTS: Record<number, number> = {
  0: 1,
  1: 1,
  2: 2,
  3: 3,
  4: 4,
  5: 4,
};

export const DROUGHT_WINDOW = 10;
const DROUGHT_BOOST = 3;
const STREAK_WINDOW = 4;
/**
 * In danger, tiers at or above this are scaled by DANGER_PENALTY, the top tier by
 * DANGER_PENALTY_TOP (fractional weights, no floor since #3904: the old floor of 1 left the
 * weight-1 top tier unpenalised). #3920: tiers 2-4 x0.2 and tier 5 x0.35 (x0.25 since #3967) (on #3904's ladder,
 * tiers 3-6 and 7; the same intent, measured on the sim's spam suite). #3904 also removed
 * #3697's second danger rule, which also multiplied the tiers below it by 1.5: on the V1 ladder
 * that stream of small pieces was what kept a mashing player's pile hovering just under the lid
 * (the spam bot outlived the 120 s lid bound), while a careful player is in danger for about
 * 10 % of its drops and only at the end of a lost game. See docs/games/cascade.md.
 * #3967: the danger factors are keyed by tier number, and on the 12-tier ladder tiers 2-5 are
 * other pieces (Lime..Orange, Mercury..Earth), but they are still the top four of the six
 * droppable tiers, so the intent holds. Stronger factors (x0.1, from tier 1) measured no better
 * (skilled 40 % against 39 % over 100 seeds), so they are kept.
 */
const DANGER_TIER_THRESHOLD = 2;
const DANGER_PENALTY = 0.2;
/**
 * The top droppable tier (tier 5: the Orange / Earth since #3960, weight 4 since #3967; weight 1
 * on #3920's ladder) gets a milder danger factor
 * (owner decision on PR #3919, kept by #3920). The numbers below are #3904's ladder. At x0.2,
 * with tiers 3-6 at x0.2 too, a mashing player's pile hovered just under the lid for longer: the spam bot's longest game was 116.4 s against the 120 s bound.
 * Measured on the 100-seed spam suite (longest game 60 / 120 Hz): x0.2 110.0 / 116.4 s, x0.35
 * 99.3 / 100.0, x0.5 100.7 / 96.8, x0.7 90.5 / 85.0. x0.35 keeps the top tier well below its
 * calm share in danger (6.4 % against 8.0 %; x0.5 leaves it at 7.8 %, a hair under) and the
 * skilled bot at 50 %.
 * #3967: with the top tier at weight 4, x0.35 no longer made it rarer in danger (24.3 % of the
 * draws against 24.1 % calm, `sampleQueue` 10 x 500), so it is x0.25: 19.4 % against 24.1 %,
 * still milder than the x0.2 of tiers 2-4.
 */
const DANGER_PENALTY_TOP = 0.25;
/** The top droppable tier. */
const TOP_TIER = DROPPABLE_PIECE_TIERS[DROPPABLE_PIECE_TIERS.length - 1] ?? 0;

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
        const penalty = tier === TOP_TIER ? DANGER_PENALTY_TOP : DANGER_PENALTY;
        weights[tier] = (weights[tier] ?? 0) * penalty;
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
