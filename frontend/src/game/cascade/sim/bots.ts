/**
 * Cascade sim bots (#2893). A bot decides when to tap and where to drop; the harness owns
 * the clock, the queue and the engine.
 *  - spam: taps every 200-250 ms at a random x (the lid test's bot, #3694).
 *  - random: taps every 600-1200 ms at a random x.
 *  - heuristic: waits for the board to calm, then drops where it lands touching a same-tier
 *    piece, else where the pile is lowest. It aims to merge.
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

export const BOTS: Record<string, Bot> = {
  heuristic: heuristicBot,
  random: randomBot,
  spam: spamBot,
};
