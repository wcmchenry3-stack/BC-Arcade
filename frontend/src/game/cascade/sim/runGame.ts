/**
 * Cascade sim: play one seeded game headlessly and measure it (#2893).
 *
 * Drives the real engine (or a candidate from `SimConfig.createEngine`) frame by frame at 60 or
 * 120 Hz, with the real spawn selector and queue (`createPieceQueue` / `advanceQueue`) fed by a
 * seeded RNG, exactly as `CascadeScreen` does: the tap is gated by `canDrop()`, `isInDanger`
 * comes from the pile height, the history is the last DROUGHT_WINDOW queue entries. Same seed,
 * same bot, same frame rate, same engine = the same GameMetrics (step cost aside).
 *
 * The sim only observes. Guard-rail events are counted, never acted on (#1716: defensive
 * removals broke E2E), and no body is deleted or moved by the harness.
 *
 * #3697 adds, all measured here from what the engine exposes (nothing in the engine is for the
 * sim): wall penetration (every frame, from the snapshots, at each piece's current size), chain
 * merge latency (from the merge events' piece ids), when each tier first existed, and the win.
 */
import type { GameState, PieceSnapshot } from "../engine";
import { advanceQueue, createPieceQueue } from "../pieceQueue";
import { DROUGHT_WINDOW } from "../spawnSelector";
import type { Bot } from "./bots";
import {
  resolveConstants,
  resolveEngine,
  streamRng,
  type FrameRateHz,
  type SimConfig,
} from "./config";
import { packingDensity, touchingGaps } from "./physicsFeel";
import { createGameState } from "../render/frame";

export const DEFAULT_MAX_SIM_MS = 180_000;
/** Sampling period for the physics-feel metrics (simulated ms). */
export const SAMPLE_MS = 50;
/** Board is calm when no piece moves faster than this (px per second). */
export const SETTLE_SPEED_PX_S = 18;
/** ...and stays calm this long (ms) for the settle time to count. */
export const SETTLE_HOLD_MS = 200;
/** A piece slower than this (px per second) at two samples in a row is "settled" for jitter. */
export const JITTER_SPEED_PX_S = 30;
/** A drop starts a chain episode when this many merges follow it. */
export const CHAIN_MIN_MERGES = 3;
/**
 * Chain latency: a merge product that, at full size, touches a same-tier piece when it is made
 * (gap at most CHAIN_TOUCH_PX) is watched until it merges again; after CHAIN_WATCH_MS it is a miss.
 */
export const CHAIN_TOUCH_PX = 1;
export const CHAIN_WATCH_MS = 1000;
/** A piece more than this far into a wall or the floor is a penetration a player could see. */
export const WALL_PENETRATION_PX = 1;

/** How a run ended: the lid, the time cap, or (a `stopOnWin` run) the capstone. */
export type EndedBy = "overflow" | "hardStop" | "cap" | "win";

export interface GameMetrics {
  seed: number;
  hz: number;
  bot: string;
  /** Simulated length of the game (ms). */
  simMs: number;
  endedBy: EndedBy;
  score: number;
  drops: number;
  merges: number;
  /** Highest tier that ever existed. */
  topTier: number;
  dropsByTier: number[];
  mergesByTier: number[];
  /** Score earned by merges that produced each tier. Sums to `score`. */
  scoreByTier: number[];
  /** Longest run of consecutive drops without each tier (0 for non-droppable tiers). */
  maxDroughtByTier: number[];
  /** The engine's win event (#3697: emitted when the capstone is made; #3699 builds on it). */
  won: boolean;
  timeToWinMs: number | null;
  /** Simulated ms at which each tier first existed (dropped or merged), null if never. */
  tierFirstMs: (number | null)[];
  feel: {
    /** Mean packing density over calm samples with 3+ pieces; null if none. */
    packingDensity: number | null;
    /** Visible gap between touching neighbours (px): mean, largest gap, deepest overlap. */
    gapMeanPx: number | null;
    gapMaxPx: number | null;
    overlapMaxPx: number | null;
    touchingPairSamples: number;
    /** Drop to calm (ms), mean over finished episodes. */
    settleAfterDropMs: number | null;
    /** Last merge of a 3+ chain to calm (ms), mean. */
    settleAfterChainMs: number | null;
    dropEpisodes: number;
    chainEpisodes: number;
    /** Episodes cut off by the next drop before the board calmed. */
    censoredEpisodes: number;
    /** censored / (finished + censored): how much of the settle data is missing. */
    settleCensoredFraction: number | null;
    /** Mean displacement of settled pieces (px per simulated second). */
    jitterPxPerS: number | null;
    guardRailEvents: number;
    guardRailPerMin: number;
    /** Deepest a piece went into a wall or the floor (px, at its current size), every frame. */
    wallDepthMaxPx: number;
    /** Frames x pieces more than WALL_PENETRATION_PX into a wall or the floor, per minute. */
    wallPenetrationPerMin: number;
    /** Chain merge latency (ms) of every watched merge product that merged again in time. */
    chainLatencyMs: number[];
    /** Watched merge products that had not merged again after CHAIN_WATCH_MS. */
    chainMisses: number;
  };
  /** Wall-clock cost of `engine.step`. Measured, never part of the deterministic baseline. */
  cost: {
    meanStepMs: number;
    /** Mean over frames with 20+ pieces on the board; null if there never were. */
    meanStepMsGe20: number | null;
    p95StepMs: number;
    maxStepMs: number;
  };
}

export interface RunOptions {
  seed: number;
  hz: FrameRateHz;
  bot: Bot;
  maxSimMs?: number;
  config?: SimConfig;
  /** End the run at the first win event (the capstone runs: time to the win). */
  stopOnWin?: boolean;
}

const nowMs = (): number =>
  typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();

function mean(sum: number, n: number): number | null {
  return n > 0 ? sum / n : null;
}

// One measurement loop on purpose: splitting it would only pass state through arguments.
// eslint-disable-next-line max-lines-per-function, complexity
export function runGame(opts: RunOptions): GameMetrics {
  const { seed, hz, bot } = opts;
  const maxSimMs = opts.maxSimMs ?? DEFAULT_MAX_SIM_MS;
  const c = resolveConstants(opts.config);
  const engine = resolveEngine(opts.config);
  const queueRng = streamRng(seed, "queue");
  const botRng = streamRng(seed, "bot");
  const frameMs = 1000 / hz;
  const tiers = c.maxTier + 1;
  // Engine velocities are px per fixed step; the thresholds are px per second.
  const speedPxS = (p: PieceSnapshot): number => Math.hypot(p.vx, p.vy) * (1000 / c.fixedStepMs);

  let queue = createPieceQueue([], queueRng);
  let history = [queue.current, queue.next];

  const dropsByTier = new Array<number>(tiers).fill(0);
  const mergesByTier = new Array<number>(tiers).fill(0);
  const scoreByTier = new Array<number>(tiers).fill(0);
  const dropSeq: number[] = [];
  const tierFirstMs = new Array<number | null>(tiers).fill(null);
  let drops = 0;
  let merges = 0;
  let topTier = 0;
  let guardRails = 0;
  let endedBy: EndedBy = "cap";
  let won = false;
  let timeToWinMs: number | null = null;

  // physics feel accumulators
  let densitySum = 0;
  let densityN = 0;
  let gapSum = 0;
  let gapN = 0;
  let gapMax = -Infinity;
  let overlapMax = 0;
  let calmStart: number | null = null;
  let episode: { dropT: number; merges: number; lastMergeT: number } | null = null;
  let settleDropSum = 0;
  let settleDropN = 0;
  let settleChainSum = 0;
  let settleChainN = 0;
  let censored = 0;
  let jitterSum = 0;
  let jitterN = 0;
  let prev: { t: number; pieces: Map<number, PieceSnapshot> } | null = null;
  // Wall penetration, read every frame into one reused state (no allocation per frame).
  const frameState: GameState = createGameState();
  let wallDepthMax = 0;
  let wallPenetrations = 0;
  // Chain latency: watched merge product id -> simulated ms it was made.
  const chainWatch = new Map<number, number>();
  const chainLatencyMs: number[] = [];
  let chainMisses = 0;

  const measureWalls = (): void => {
    const minX = c.wallThickness;
    const maxX = c.worldWidth - c.wallThickness;
    const floorTop = c.worldHeight - c.floorThickness;
    for (const p of engine.getState(frameState).pieces) {
      const r = c.physicsRadius(p.tier) * (p.scale ?? 1);
      const depth = Math.max(0, minX + r - p.x, p.x + r - maxX, p.y + r - floorTop);
      if (depth > wallDepthMax) wallDepthMax = depth;
      if (depth > WALL_PENETRATION_PX) wallPenetrations++;
    }
  };

  /** A merge product touching a same-tier piece at full size when made is watched (chain). */
  const watchChain = (products: { id: number; tier: number; x: number; y: number }[]): void => {
    const pieces = engine.getState().pieces;
    for (const m of products) {
      if (m.tier >= c.maxTier) continue;
      const full = c.physicsRadius(m.tier);
      const touches = pieces.some(
        (o) =>
          o.id !== m.id &&
          o.tier === m.tier &&
          Math.hypot(o.x - m.x, o.y - m.y) - full - c.physicsRadius(o.tier) * (o.scale ?? 1) <=
            CHAIN_TOUCH_PX
      );
      if (touches) chainWatch.set(m.id, t);
    }
  };

  const costs: number[] = [];
  let costSum = 0;
  let costGe20Sum = 0;
  let costGe20N = 0;

  let t = 0;
  let nextTapAt = 0;
  let nextSampleAt = SAMPLE_MS;
  let lastDropT = 0;

  const sample = (): void => {
    const pieces = engine.getState().pieces;
    let maxSpeed = 0;
    for (const p of pieces) maxSpeed = Math.max(maxSpeed, speedPxS(p));
    const calm = maxSpeed < SETTLE_SPEED_PX_S;
    if (!calm) calmStart = null;
    else if (calmStart === null) calmStart = t;

    if (calm && pieces.length >= 3) {
      const d = packingDensity(pieces, c);
      if (d !== null) {
        densitySum += d;
        densityN++;
      }
      for (const g of touchingGaps(pieces, c)) {
        gapSum += g;
        gapN++;
        gapMax = Math.max(gapMax, g);
        overlapMax = Math.max(overlapMax, -g);
      }
    }

    if (episode && calmStart !== null && t - calmStart >= SETTLE_HOLD_MS) {
      settleDropSum += Math.max(0, calmStart - episode.dropT);
      settleDropN++;
      if (episode.merges >= CHAIN_MIN_MERGES) {
        settleChainSum += Math.max(0, calmStart - episode.lastMergeT);
        settleChainN++;
      }
      episode = null;
    }

    const byId = new Map<number, PieceSnapshot>();
    for (const p of pieces) byId.set(p.id, p);
    if (prev) {
      const dtS = (t - prev.t) / 1000;
      for (const p of pieces) {
        const q = prev.pieces.get(p.id);
        if (!q || dtS <= 0) continue;
        if (speedPxS(p) >= JITTER_SPEED_PX_S || speedPxS(q) >= JITTER_SPEED_PX_S) {
          continue;
        }
        jitterSum += Math.hypot(p.x - q.x, p.y - q.y) / dtS;
        jitterN++;
      }
    }
    prev = { t, pieces: byId };
  };

  while (t < maxSimMs) {
    if (t >= nextTapAt) {
      const pieces = engine.getState().pieces;
      const view = {
        tier: queue.current,
        pieces,
        constants: c,
        rng: botRng,
        nowMs: t,
        canDrop: engine.canDrop(),
        sinceDropMs: t - lastDropT,
        calmForMs: calmStart === null ? 0 : t - calmStart,
      };
      if (!bot.shouldTap || bot.shouldTap(view)) {
        // The screen's gate: a tap while the last piece is over the lid does nothing.
        if (view.canDrop) {
          const isInDanger = pieces.some((p) => p.y < c.lidY + c.dangerMargin);
          const tier = queue.current;
          queue = advanceQueue(queue, history, isInDanger, queueRng);
          history = [...history, queue.next].slice(-DROUGHT_WINDOW);
          engine.drop(tier, bot.chooseX(view));
          drops++;
          dropsByTier[tier]!++;
          dropSeq.push(tier);
          if (tierFirstMs[tier] === null) tierFirstMs[tier] = t;
          topTier = Math.max(topTier, tier);
          if (episode) censored++;
          episode = { dropT: t, merges: 0, lastMergeT: t };
          calmStart = null;
          lastDropT = t;
        }
        nextTapAt = t + bot.nextDelayMs(botRng);
      }
    }

    const t0 = nowMs();
    const { events } = engine.step(frameMs);
    const cost = nowMs() - t0;
    t += frameMs;
    costs.push(cost);
    costSum += cost;
    if (drops - merges >= 20) {
      costGe20Sum += cost;
      costGe20N++;
    }

    let over = false;
    let products: { id: number; tier: number; x: number; y: number }[] | null = null;
    for (const e of events) {
      if (e.type === "merge") {
        merges++;
        mergesByTier[e.result]!++;
        scoreByTier[e.result]! += c.scoreValue(e.result);
        topTier = Math.max(topTier, e.result);
        if (tierFirstMs[e.result] === null) tierFirstMs[e.result] = t;
        if (episode) {
          episode.merges++;
          episode.lastMergeT = t;
        }
        // A scripted test engine may omit the ids; then there is no chain timing.
        if (e.id !== undefined) {
          for (const parent of e.parentIds ?? []) {
            const made = chainWatch.get(parent);
            if (made === undefined) continue;
            chainLatencyMs.push(t - made);
            chainWatch.delete(parent);
          }
          (products ??= []).push({ id: e.id, tier: e.result, x: e.x, y: e.y });
        }
      } else if (e.type === "guardRailFired") {
        guardRails++;
      } else if (e.type === "gameOver") {
        endedBy = e.reason;
        over = true;
      } else if (e.type === "win" && !won) {
        won = true;
        timeToWinMs = t;
      }
    }
    if (products) watchChain(products);
    for (const [id, made] of chainWatch) {
      if (t - made > CHAIN_WATCH_MS) {
        chainMisses++;
        chainWatch.delete(id);
      }
    }
    measureWalls();

    if (t >= nextSampleAt) {
      sample();
      nextSampleAt += SAMPLE_MS;
    }
    if (over) break;
    if (won && opts.stopOnWin) {
      endedBy = "win";
      break;
    }
  }

  const score = engine.getState().score;
  engine.destroy();

  // Longest run of consecutive drops without each droppable tier.
  const maxDroughtByTier = new Array<number>(tiers).fill(0);
  for (const tier of c.droppableTiers) {
    let run = 0;
    let best = 0;
    for (const d of dropSeq) {
      run = d === tier ? 0 : run + 1;
      best = Math.max(best, run);
    }
    maxDroughtByTier[tier] = best;
  }

  costs.sort((a, b) => a - b);
  const simS = t / 1000;
  return {
    seed,
    hz,
    bot: bot.name,
    simMs: t,
    endedBy,
    score,
    drops,
    merges,
    topTier,
    dropsByTier,
    mergesByTier,
    scoreByTier,
    maxDroughtByTier,
    won,
    timeToWinMs,
    tierFirstMs,
    feel: {
      packingDensity: mean(densitySum, densityN),
      gapMeanPx: mean(gapSum, gapN),
      gapMaxPx: gapN > 0 ? gapMax : null,
      overlapMaxPx: gapN > 0 ? overlapMax : null,
      touchingPairSamples: gapN,
      settleAfterDropMs: mean(settleDropSum, settleDropN),
      settleAfterChainMs: mean(settleChainSum, settleChainN),
      dropEpisodes: settleDropN,
      chainEpisodes: settleChainN,
      censoredEpisodes: censored,
      settleCensoredFraction: mean(censored, settleDropN + censored),
      jitterPxPerS: mean(jitterSum, jitterN),
      guardRailEvents: guardRails,
      guardRailPerMin: simS > 0 ? guardRails / (simS / 60) : 0,
      wallDepthMaxPx: wallDepthMax,
      wallPenetrationPerMin: simS > 0 ? wallPenetrations / (simS / 60) : 0,
      chainLatencyMs,
      chainMisses,
    },
    cost: {
      meanStepMs: costs.length ? costSum / costs.length : 0,
      meanStepMsGe20: mean(costGe20Sum, costGe20N),
      p95StepMs: costs.length
        ? costs[Math.min(costs.length - 1, Math.floor(costs.length * 0.95))]!
        : 0,
      maxStepMs: costs.length ? costs[costs.length - 1]! : 0,
    },
  };
}
