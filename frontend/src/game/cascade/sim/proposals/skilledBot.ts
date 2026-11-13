/**
 * Cascade feel proposals (#3697, phase 1): a "skilled" bot, a second proxy for the player the
 * win has to be reachable for.
 *
 * The harness's heuristic bot (`../bots.ts`) merges when it can and otherwise drops where the
 * pile is lowest, so it scatters small pieces over the big ones and loses to clutter. This bot
 * plays the way a practised Suika player does: it keeps the pile graded (big pieces towards the
 * left wall, small ones towards the right), sets up merges by dropping next to a piece one tier
 * up or down, and avoids burying a smaller piece under a bigger one. It sees what a player sees
 * (the board and the piece in hand), waits for the board to calm like the heuristic, and drops
 * no faster than it does.
 *
 * Sim-only: it is not in the harness's `BOTS` (the baseline and the gate use those three).
 */
import type { PieceSnapshot } from "../../engine";
import type { Bot, BotView } from "../bots";
import { heuristicBot } from "../bots";

const X_STEP_PX = 4;
/** Contact tolerance when listing the pieces a landed drop would touch (px). */
const TOUCH_PX = 3;

interface Landing {
  y: number;
  touching: PieceSnapshot[];
}

function land(view: BotView, x: number, r: number): Landing {
  const { constants: c, pieces } = view;
  let y = c.worldHeight - c.floorThickness - r;
  for (const p of pieces) {
    const reach = r + c.physicsRadius(p.tier);
    const dx = Math.abs(p.x - x);
    if (dx >= reach) continue;
    y = Math.min(y, p.y - Math.sqrt(reach * reach - dx * dx));
  }
  const touching = pieces.filter(
    (p) => Math.hypot(p.x - x, p.y - y) <= r + c.physicsRadius(p.tier) + TOUCH_PX
  );
  return { y, touching };
}

export const skilledBot: Bot = {
  name: "skilled",
  nextDelayMs: heuristicBot.nextDelayMs,
  shouldTap: heuristicBot.shouldTap,
  chooseX(view) {
    const { constants: c, tier, rng } = view;
    const r = c.physicsRadius(tier);
    const minX = c.wallThickness + r;
    const maxX = c.worldWidth - c.wallThickness - r;
    const top = Math.max(...c.droppableTiers);
    // Where this tier belongs in a graded pile: the biggest drop by the left wall's side of the
    // small-piece zone, the smallest at the right wall.
    const home = minX + (maxX - minX) * (0.55 + 0.45 * (1 - tier / Math.max(1, top)));
    let bestX = (minX + maxX) / 2;
    let best = -Infinity;
    for (let x = minX; x <= maxX; x += X_STEP_PX) {
      const { y, touching } = land(view, x, r);
      let score = y; // lower is better (y grows downwards)
      for (const p of touching) {
        if (p.tier === tier) score += 1000 + 20 * tier;
        else if (Math.abs(p.tier - tier) === 1) score += 25;
        // Resting on a smaller piece buries it under this one.
        if (p.y > y && p.tier < tier) score -= 30 * (tier - p.tier);
      }
      score -= Math.abs(x - home) * 0.15;
      score += rng() * 0.01;
      if (score > best) {
        best = score;
        bestX = x;
      }
    }
    return bestX;
  },
};
