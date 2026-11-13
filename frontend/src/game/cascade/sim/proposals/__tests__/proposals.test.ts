/**
 * Cascade feel proposals (#3697, phase 1): the three planck tunings behind the sim seam.
 *
 *  - The levers reproduce today when left at today's numbers (ladder, selector), and the spike's
 *    B run through the proposal factory is the spike's B, so a proposal's differences are its
 *    own numbers.
 *  - The lid rules hold on every proposal (the candidate lid fixtures, rebuilt for its radii).
 *  - The new merge rules: grow-in clamped inside the walls, chain reach, the win event.
 */
import type { EngineEvent, StepResult } from "../../../engine";
import {
  FIXED_STEP_MS,
  FLOOR_THICKNESS,
  HARD_STOP_SETTLE_TICKS,
  OVERFLOW_IGNORE_MERGE_TICKS,
  OVERFLOW_LINE_Y,
  OVERFLOW_TICKS_THRESHOLD,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../../../constants";
import { CAPSTONE_TIER, TIERS } from "../../../tiers";
import { selectNextTier } from "../../../spawnSelector";
import { BOTS } from "../../bots";
import { streamRng } from "../../config";
import { runGame, type GameMetrics } from "../../runGame";
import { candidateConfig } from "../../candidates/candidates";
import {
  PRODUCTION_DIFFICULTY,
  cherriesPerDrop,
  droppableTiers,
  ladderRadius,
  makeSelector,
} from "../difficulty";
import {
  EASED,
  PROPOSALS,
  PROPOSAL_IDS,
  SPIKE_B,
  makeProposalEngine,
  proposalConfig,
  resolveProposal,
  type ProposalId,
} from "../tunings";
import { skilledBot } from "../skilledBot";

const HZ60 = 1000 / 60;
const HZ120 = 1000 / 120;
const floorTop = WORLD_HEIGHT - FLOOR_THICKNESS;

function withoutCost(m: GameMetrics): Omit<GameMetrics, "cost"> {
  const { cost: _cost, ...rest } = m;
  return rest;
}
function run(e: ReturnType<typeof makeProposalEngine>, n: number, frameMs = HZ60): StepResult[] {
  const out: StepResult[] = [];
  for (let i = 0; i < n && !e.getState().gameOver; i++) out.push(e.step(frameMs));
  return out;
}
const events = (rs: StepResult[]): EngineEvent[] => rs.flatMap((r) => r.events);
const gameOver = (rs: StepResult[]) => events(rs).find((e) => e.type === "gameOver");

describe("the levers at today's numbers", () => {
  it("the ladder formula gives today's radii", () => {
    const r = ladderRadius(PRODUCTION_DIFFICULTY);
    expect(TIERS.map((t) => r(t.tier))).toEqual(TIERS.map((t) => t.radius));
  });

  it("the selector draws exactly what selectNextTier draws, calm and in danger", () => {
    const mine = makeSelector(PRODUCTION_DIFFICULTY);
    for (const danger of [false, true]) {
      const a = streamRng(5, "queue");
      const b = streamRng(5, "queue");
      const history: number[] = [];
      for (let i = 0; i < 2000; i++) {
        const t = selectNextTier(history, danger, a);
        expect(mine(history, danger, b)).toBe(t);
        history.push(t);
      }
    }
  });

  it("the spike's B through the proposal factory replays the spike's B game for game", () => {
    const opts = { seed: 3, hz: 60 as const, bot: BOTS.random!, maxSimMs: 30_000 };
    const spike = runGame({ ...opts, config: candidateConfig("B") });
    const viaProposal = runGame({ ...opts, config: proposalConfig(SPIKE_B) });
    expect(spike.merges).toBeGreaterThan(3);
    expect(withoutCost(viaProposal)).toEqual(withoutCost(spike));
  });
});

describe("the eased difficulty", () => {
  it("is smaller and flatter, with tier 5 droppable and on the canvas when it spawns", () => {
    const r = ladderRadius(EASED);
    expect(droppableTiers(EASED)).toEqual([0, 1, 2, 3, 4, 5]);
    // Tier 5 spawns at OVERFLOW_LINE_Y - r - 5 (the drop inset): its top edge must be on screen.
    expect(OVERFLOW_LINE_Y - 2 * r(5) - 5).toBeGreaterThanOrEqual(0);
    // Two tier-10 pieces still fit side by side, and the capstone fits the bin.
    expect(4 * r(10)).toBeLessThan(WORLD_WIDTH - 2 * WALL_THICKNESS);
    for (let t = 1; t <= CAPSTONE_TIER; t++) expect(r(t)).toBeGreaterThan(r(t - 1));
    expect(cherriesPerDrop(EASED)).toBeGreaterThan(2 * cherriesPerDrop(PRODUCTION_DIFFICULTY));
  });

  it("the selector only offers droppable tiers and favours small ones in danger", () => {
    const select = makeSelector(PROPOSALS.tight.difficulty);
    const rng = streamRng(9, "queue");
    const count = (danger: boolean) => {
      const n = new Array<number>(CAPSTONE_TIER + 1).fill(0);
      const history: number[] = [];
      for (let i = 0; i < 4000; i++) {
        const t = select(history, danger, rng);
        n[t]!++;
        history.push(t);
      }
      return n;
    };
    const calm = count(false);
    const danger = count(true);
    expect(calm.slice(6).every((n) => n === 0)).toBe(true);
    expect(calm[5]).toBeGreaterThan(0);
    expect(danger[0]! + danger[1]!).toBeGreaterThan(2 * (calm[0]! + calm[1]!));
    expect(danger[5]).toBeLessThan(0.6 * calm[5]!);
  });
});

type Placed = { tier: number; x: number; y: number };

/**
 * A column standing on the floor: tiers 3+ in descending order (the largest that fit first),
 * whose top ends 25-45 px over the lid (y 35-55), so a pile settles there without touching the
 * canvas top. Today's radii give the production fixture's column (11, 10, 9; top at y = 48).
 */
function column(r: (t: number) => number, x: number): Placed[] {
  const search = (from: number, bottom: number, acc: Placed[]): Placed[] | null => {
    if (acc.length > 0 && bottom >= 35 && bottom <= 55) return acc;
    for (let t = from; t >= 3; t--) {
      const top = bottom - 2 * r(t);
      if (top < 35) continue;
      const found = search(t - 1, top, [...acc, { tier: t, x, y: bottom - r(t) }]);
      if (found) return found;
    }
    return null;
  };
  return search(CAPSTONE_TIER, floorTop, [])!;
}

const LANE_X = 360;

describe.each(PROPOSAL_IDS)("the lid on proposal %s", (id: ProposalId) => {
  const p = resolveProposal(PROPOSALS[id]);
  const r = ladderRadius(p.difficulty);
  const make = () => makeProposalEngine(p);
  const COLUMN = column(r, 121);
  const colTop = COLUMN[COLUMN.length - 1]!.y - r(COLUMN[COLUMN.length - 1]!.tier);
  const stacked = () => {
    const e = make();
    e.restore(COLUMN, 0);
    return e;
  };

  it("builds a column that is over the lid and under the canvas top", () => {
    expect(colTop).toBeLessThan(OVERFLOW_LINE_Y);
    expect(colTop).toBeGreaterThan(0);
    expect(tall).toBeDefined();
  });

  it("a pile settled over the lid ends the game after the grace and the full count", () => {
    const results = run(stacked(), OVERFLOW_IGNORE_MERGE_TICKS + OVERFLOW_TICKS_THRESHOLD + 10);
    expect(gameOver(results)).toEqual({ type: "gameOver", reason: "overflow" });
    expect(results).toHaveLength(OVERFLOW_IGNORE_MERGE_TICKS + OVERFLOW_TICKS_THRESHOLD);
  });

  it("the piece falling from the spawner is ignored", () => {
    const e = make();
    e.drop(Math.max(...droppableTiers(p.difficulty)), 200);
    let max = 0;
    for (let i = 0; i < 120; i++) {
      e.step(HZ60);
      max = Math.max(max, e.getState().dangerRatio);
    }
    expect(max).toBe(0);
    expect(e.getState().gameOver).toBe(false);
  });

  it("a merge near the lid resets the count and pauses it for the grace", () => {
    const e = stacked();
    run(e, OVERFLOW_IGNORE_MERGE_TICKS + 30);
    expect(e.getState().dangerRatio).toBeGreaterThan(0);
    e.drop(0, LANE_X);
    e.drop(0, LANE_X);
    expect(e.step(HZ60).events.some((ev) => ev.type === "merge")).toBe(true);
    expect(e.getState().dangerRatio).toBe(0);
    run(e, OVERFLOW_IGNORE_MERGE_TICKS - 1);
    expect(e.getState().dangerRatio).toBe(0);
    run(e, 5);
    expect(e.getState().dangerRatio).toBeGreaterThan(0);
  });

  /**
   * The smallest droppable tier that is not in the column (it must not merge) and rests on it
   * with its top edge 5+ px above the canvas.
   */
  const tall = droppableTiers(p.difficulty).find(
    (t) => !COLUMN.some((c) => c.tier === t) && colTop - 2 * r(t) <= -5
  )!;

  it("a settled piece at the canvas top is a hard stop at once", () => {
    const e = make();
    const t = tall;
    expect(colTop - 2 * r(t)).toBeLessThanOrEqual(-5);
    e.restore([...COLUMN, { tier: t, x: 121, y: colTop - r(t) }], 0);
    expect(e.step(HZ60).events).toContainEqual({ type: "gameOver", reason: "hardStop" });
    expect(e.getState()).toMatchObject({ gameOver: true, dangerRatio: 1, canDrop: false });
  });

  it("a dropped piece resting above the canvas hard-stops only after the settle run", () => {
    const e = make();
    e.restore(COLUMN, 0);
    e.drop(tall, 121);
    const results = run(e, 120);
    expect(gameOver(results)).toEqual({ type: "gameOver", reason: "hardStop" });
    expect(results.length).toBeGreaterThanOrEqual(HARD_STOP_SETTLE_TICKS);
    expect(results.length).toBeLessThan(OVERFLOW_TICKS_THRESHOLD);
  });

  it("canDrop holds until the dropped piece is below the lid, the same at 60 and 120 Hz", () => {
    const clearMs = (frameMs: number): number => {
      const e = make();
      e.drop(3, 200);
      expect(e.canDrop()).toBe(false);
      let t = 0;
      while (!e.canDrop() && t < 2000) {
        e.step(frameMs);
        t += frameMs;
      }
      expect(e.getState().pieces[0]!.y - r(3)).toBeGreaterThanOrEqual(OVERFLOW_LINE_Y);
      return t;
    };
    const at60 = clearMs(HZ60);
    expect(at60).toBeLessThan(30 * FIXED_STEP_MS);
    expect(Math.abs(at60 - clearMs(HZ120))).toBeLessThan(HZ60 + 1);
  });

  it("restore clears the gate; canDrop is false after game over", () => {
    const e = make();
    e.drop(0, 200);
    e.restore([{ tier: 0, x: 200, y: 500 }], 0);
    expect(e.canDrop()).toBe(true);
    const c = stacked();
    run(c, OVERFLOW_IGNORE_MERGE_TICKS + OVERFLOW_TICKS_THRESHOLD);
    expect(c.canDrop()).toBe(false);
  });
});

describe.each(["tight", "balanced", "lively"] as const)("merge rules on proposal %s", (id) => {
  const p = resolveProposal(PROPOSALS[id]);
  const r = ladderRadius(p.difficulty);

  it("a merge against a wall is made where its full size is inside the wall", () => {
    const e = makeProposalEngine(p);
    const t = 6;
    const y = floorTop - r(t);
    // Two tier-6 pieces touching, the left one against the left wall: their midpoint is closer
    // to the wall than a tier-7 radius.
    e.restore(
      [
        { tier: t, x: WALL_THICKNESS + r(t), y },
        { tier: t, x: WALL_THICKNESS + 3 * r(t) - 1, y },
      ],
      0
    );
    expect(events(run(e, 1))).toContainEqual(expect.objectContaining({ type: "merge" }));
    run(e, 30);
    const piece = e.getState().pieces[0]!;
    expect(piece.tier).toBe(t + 1);
    expect(piece.x - r(t + 1)).toBeGreaterThanOrEqual(WALL_THICKNESS - 1);
    expect(e.stats.railBeyondTolerance).toBe(0);
  });

  it("a merge product touching a same-tier piece merges again within 150 ms", () => {
    const e = makeProposalEngine(p);
    // Two tier-1 pieces touching on the floor, and a tier 2 resting in the valley on top of
    // them. Their product (a tier 2 made at their midpoint, on the floor) touches it at full
    // size, though it starts at its parents' radius.
    const y1 = floorTop - r(1);
    const x0 = 150;
    const x1 = x0 + 2 * r(1) - 1;
    const mid = (x0 + x1) / 2;
    const y2 = y1 - Math.sqrt((r(1) + r(2)) ** 2 - ((x1 - x0) / 2) ** 2) - 0.5;
    e.restore(
      [
        { tier: 1, x: x0, y: y1 },
        { tier: 1, x: x1, y: y1 },
        { tier: 2, x: mid, y: y2 },
      ],
      0
    );
    const results = run(e, Math.ceil(150 / FIXED_STEP_MS));
    const merges = events(results).filter((ev) => ev.type === "merge");
    expect(merges.map((m) => (m as { result: number }).result)).toEqual([2, 3]);
    expect(e.stats.chainLatencySteps).toHaveLength(1);
    expect(e.stats.chainLatencySteps[0]! * FIXED_STEP_MS).toBeLessThan(150);
  });

  it("making the capstone emits a win", () => {
    const e = makeProposalEngine(p);
    const t = CAPSTONE_TIER - 1;
    e.restore(
      [
        { tier: t, x: 150, y: floorTop - r(t) },
        { tier: t, x: 150 + 2 * r(t) - 1, y: floorTop - r(t) },
      ],
      0
    );
    expect(events(run(e, 1))).toContainEqual({ type: "win" });
  });
});

describe("the proposals in whole games", () => {
  it.each(PROPOSAL_IDS)("%s replays the same game from the same seed", (id) => {
    const opts = { seed: 11, hz: 60 as const, bot: BOTS.random!, maxSimMs: 20_000 };
    const first = runGame({ ...opts, config: proposalConfig(PROPOSALS[id]) });
    const second = runGame({ ...opts, config: proposalConfig(PROPOSALS[id]) });
    expect(first.merges).toBeGreaterThan(3);
    expect(withoutCost(second)).toEqual(withoutCost(first));
  });

  it("the skilled bot drops inside the walls and merges", () => {
    const m = runGame({
      seed: 2,
      hz: 60,
      bot: skilledBot,
      maxSimMs: 30_000,
      config: proposalConfig(PROPOSALS.balanced),
    });
    expect(m.drops).toBeGreaterThan(15);
    expect(m.merges / m.drops).toBeGreaterThan(0.5);
  });

  it("a run that stops at the win records when each tier first existed", () => {
    const m = runGame({
      seed: 1,
      hz: 60,
      bot: BOTS.heuristic!,
      maxSimMs: 20_000,
      config: proposalConfig(PROPOSALS.lively),
      stopOnWin: true,
    });
    expect(m.tierFirstMs[m.topTier]).not.toBeNull();
    expect(m.tierFirstMs[CAPSTONE_TIER]).toBeNull();
    const seen = m.tierFirstMs.filter((t): t is number => t !== null);
    expect(seen.length).toBeGreaterThanOrEqual(m.topTier);
  });

  // The lid gate (#3694): the spam bot must lose inside 120 s. Each proposal's seed is its
  // longest spam game in the 100-seed run (lively's is one that outlived the bound on the
  // shared radii, before its own).
  it.each([
    ["tight", 22],
    ["balanced", 85],
    ["lively", 32],
  ] as const)("spam still loses inside the lid's bound on %s (seed %i)", (id, seed) => {
    const m = runGame({
      seed,
      hz: 60,
      bot: BOTS.spam!,
      maxSimMs: 120_000,
      config: proposalConfig(PROPOSALS[id]),
    });
    expect(m.endedBy).not.toBe("cap");
  });
});
