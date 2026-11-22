/**
 * Cascade sim bots (#2893). A bot decides when to tap and where to drop; the harness owns
 * the clock, the queue and the engine.
 *  - spam: taps every 200-250 ms at a random x (the lid test's bot, #3694).
 *  - random: taps every 600-1200 ms at a random x.
 *  - heuristic: waits for the board to calm, then drops where it lands touching a same-tier
 *    piece, else where the pile is lowest. It aims to merge.
 *  - skilled (#3697): the heuristic's timing, but it plays the way a practised Suika player
 *    does: it keeps the pile graded (big pieces towards the left wall, small ones towards the
 *    right), sets up merges by dropping next to a piece one tier up or down, and avoids burying a
 *    smaller piece under a bigger one. The capstone runs (time to the win) use it; the heuristic
 *    buries small pieces under big ones and loses to clutter, so it understates what a player
 *    who plans can do. It is a proxy too: a practised human probably plays better than either.
 */
import type { PieceSnapshot } from "../engine";
import type { RandomSource } from "../../_shared/seededRng";
import type { SimConstants } from "./config";

export interface BotView {
  tier: number;
  pieces: PieceSnapshot[];
  constants: SimConstants;
  rng: RandomSource;
  nowMs: number;
  /** The engine's drop gate (the lid). */
  canDrop: boolean;
  /** ms since the last drop. */
  sinceDropMs: number;
  /** How long the whole board has been calm (no piece above `SETTLE_SPEED`), 0 if moving. */
  calmForMs: number;
}

export interface Bot {
  name: string;
  /** ms until the next tap attempt after one. */
  nextDelayMs(rng: RandomSource): number;
  /** False = not yet; the harness asks again next frame. Default true. */
  shouldTap?(view: BotView): boolean;
  chooseX(view: BotView): number;
}

function randomX(view: BotView): number {
  const { wallThickness, worldWidth } = view.constants;
  return wallThickness + view.rng() * (worldWidth - 2 * wallThickness);
}

export const spamBot: Bot = {
  name: "spam",
  nextDelayMs: (rng) => 200 + rng() * 50,
  chooseX: randomX,
};

export const randomBot: Bot = {
  name: "random",
  nextDelayMs: (rng) => 600 + rng() * 600,
  chooseX: randomX,
};

/** The heuristic waits until the board has been calm this long (ms) before dropping. */
const CALM_HOLD_MS = 200;
const MAX_WAIT_MS = 2500;
const MIN_GAP_MS = 500;
const X_STEP_PX = 6;

/** y a circle of radius r would come to rest at when dropped straight down at x. */
function landingY(view: BotView, x: number, r: number): { y: number; sameTier: boolean } {
  const { constants: c, pieces, tier } = view;
  let y = c.worldHeight - c.floorThickness - r;
  let sameTier = false;
  for (const p of pieces) {
    const reach = r + c.physicsRadius(p.tier);
    const dx = Math.abs(p.x - x);
    if (dx >= reach) continue;
    const ry = p.y - Math.sqrt(reach * reach - dx * dx);
    if (ry < y) {
      y = ry;
      sameTier = p.tier === tier;
    }
  }
  return { y, sameTier };
}

export const heuristicBot: Bot = {
  name: "heuristic",
  nextDelayMs: () => MIN_GAP_MS,
  shouldTap(view) {
    if (!view.canDrop) return false;
    if (view.sinceDropMs >= MAX_WAIT_MS) return true;
    // Wait for the pile to be calm for a moment, as a careful player would.
    return view.calmForMs >= CALM_HOLD_MS;
  },
  chooseX(view) {
    const { constants: c, tier, rng } = view;
    const r = c.physicsRadius(tier);
    const minX = c.wallThickness + r;
    const maxX = c.worldWidth - c.wallThickness - r;
    let bestX = (minX + maxX) / 2;
    let bestScore = -Infinity;
    for (let x = minX; x <= maxX; x += X_STEP_PX) {
      const { y, sameTier } = landingY(view, x, r);
      // Merging beats everything; otherwise prefer the lowest landing spot, hugging a wall a
      // little, with a tiny seeded jitter so equal columns do not always pick the same x.
      const score = (sameTier ? 1000 : 0) + y - Math.min(x - minX, maxX - x) * 0.05 + rng() * 0.01;
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
      }
    }
    return bestX;
  },
};

const SKILLED_X_STEP_PX = 4;
/** Contact tolerance when listing the pieces a landed drop would touch (px). */
const SKILLED_TOUCH_PX = 3;

/** Where a circle of radius r dropped at x comes to rest, and the pieces it then touches. */
function landing(view: BotView, x: number, r: number): { y: number; touching: PieceSnapshot[] } {
  const { constants: c, pieces } = view;
  let y = c.worldHeight - c.floorThickness - r;
  for (const p of pieces) {
    const reach = r + c.physicsRadius(p.tier);
    const dx = Math.abs(p.x - x);
    if (dx >= reach) continue;
    y = Math.min(y, p.y - Math.sqrt(reach * reach - dx * dx));
  }
  const touching = pieces.filter(
    (p) => Math.hypot(p.x - x, p.y - y) <= r + c.physicsRadius(p.tier) + SKILLED_TOUCH_PX
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
    for (let x = minX; x <= maxX; x += SKILLED_X_STEP_PX) {
      const { y, touching } = landing(view, x, r);
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

export const BOTS: Record<string, Bot> = {
  heuristic: heuristicBot,
  random: randomBot,
  spam: spamBot,
  skilled: skilledBot,
};
