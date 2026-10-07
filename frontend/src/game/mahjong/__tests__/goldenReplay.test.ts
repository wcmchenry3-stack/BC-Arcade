/**
 * Mahjong golden seeded replay (#2962, per the "Golden replay for seeded engines" rule in
 * docs/TESTING.md).
 *
 * Recorded on the engine as it was before the free-tile index of #2962, so that refactor (and
 * any later one) must leave this fixture byte-identical:
 *
 * - Deals: every registered layout is dealt with seeds 0-4 (`createGame`, which runs the
 *   backwards-build over `accessibleInUnplaced`); the dealId and a SHA-256 of the dealt tiles,
 *   in order, are recorded.
 * - Play: a scripted player on several seeded boards picks a free pair by index from
 *   `getAllFreePairs`, sometimes taps a non-matching free tile first or taps a tile twice,
 *   shuffles and undoes at fixed steps, and asks for a hint (`getAnyFreePair`) every step. Each
 *   step's free tile ids (`isFreeTile`), the hint, `hasFreePairs` and the selection's matches
 *   (`getMatchingFreeTileIds`) are folded with the canonical state into a running SHA-256;
 *   checkpoints keep exact integer fields.
 *
 * `Date.now` is pinned, so the clock fields are constant and the record tracks the game only.
 *
 * Re-record (a deliberate gameplay change only; say why in the PR):
 * `UPDATE_GOLDEN=1 npx jest src/game/mahjong/__tests__/goldenReplay.test.ts`.
 */
import { createHash } from "crypto";
import * as fs from "fs";
import * as path from "path";
import {
  createGame,
  createSeededRng,
  getAllFreePairs,
  getAnyFreePair,
  getMatchingFreeTileIds,
  hasFreePairs,
  isFreeTile,
  selectTile,
  setRng,
  shuffleBoard,
  undoMove,
} from "../engine";
import { getLayout, LAYOUTS } from "../layouts/registry";
import type { MahjongState, SlotTile } from "../types";

const FIXTURE = path.join(__dirname, "__fixtures__", "golden-replay.json");
const NOW = 1_700_000_000_000;
const DEAL_SEEDS = [0, 1, 2, 3, 4];
const CHECKPOINT_EVERY = 10;

interface Scenario {
  readonly name: string;
  readonly layoutId: string;
  readonly seed: number;
  readonly steps: number;
}

const SCENARIOS: readonly Scenario[] = [
  { name: "turtle-42", layoutId: "turtle", seed: 42, steps: 90 },
  { name: "double-pyramid-7", layoutId: "double_pyramid", seed: 7, steps: 90 },
  { name: "four-rivers-3", layoutId: "four_rivers", seed: 3, steps: 90 },
  { name: "pyramid-11", layoutId: "pyramid", seed: 11, steps: 90 },
];

function sha(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

/** Object keys sorted, so the hash tracks values rather than a refactor's key order. */
function canonical(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === "object") {
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(v).sort()) out[k] = canonical((v as Record<string, unknown>)[k]);
    return out;
  }
  return v;
}

function freeIdsOf(tiles: readonly SlotTile[]): number[] {
  return tiles.filter((t) => isFreeTile(t, tiles)).map((t) => t.id);
}

/** Everything the engine's queries say about `s`, alongside the state itself. */
function observe(s: MahjongState) {
  return {
    state: canonical(s),
    free: freeIdsOf(s.tiles),
    hint: getAnyFreePair(s.tiles),
    hasFreePairs: hasFreePairs(s.tiles),
    matching: [...getMatchingFreeTileIds(s)].sort((a, b) => a - b),
  };
}

/** One scripted step: a shuffle, an undo, or a pair (with an occasional detour first). */
function step(s: MahjongState, n: number): MahjongState {
  if (n % 17 === 8 && s.shufflesLeft > 0) return shuffleBoard(s);
  if (n % 13 === 6 && s.undoStack.length > 0) return undoMove(s, NOW);
  const pairs = getAllFreePairs(s.tiles);
  if (pairs.length === 0) return s.shufflesLeft > 0 ? shuffleBoard(s) : s;
  const [a, b] = pairs[(n * 7) % pairs.length]!;
  let next = s;
  if (n % 5 === 2) {
    // A free tile that does not match `a`, tapped first: the selection moves to `a`.
    const other = s.tiles.find((t) => t.id !== a.id && t.suit !== a.suit && isFreeTile(t, s.tiles));
    if (other) next = selectTile(next, other.id);
  }
  if (n % 7 === 3) next = selectTile(selectTile(next, a.id), a.id); // select, then deselect
  return selectTile(selectTile(next, a.id), b.id);
}

function replay(sc: Scenario) {
  setRng(createSeededRng(sc.seed * 31 + 1));
  let s: MahjongState = createGame(getLayout(sc.layoutId), sc.seed);
  let chain = sha(observe(s));
  const checkpoints: Record<string, unknown>[] = [];
  const checkpoint = (n: number) =>
    checkpoints.push({
      step: n,
      tiles: s.tiles.length,
      pairsRemoved: s.pairsRemoved,
      score: s.score,
      shufflesLeft: s.shufflesLeft,
      undo: s.undoStack.length,
      selected: s.selected?.id ?? null,
      isComplete: s.isComplete,
      isDeadlocked: s.isDeadlocked,
      chain,
    });
  checkpoint(0);
  for (let n = 1; n <= sc.steps; n++) {
    if (s.isComplete || s.isDeadlocked) break;
    s = step(s, n);
    chain = sha([chain, observe(s)]);
    if (n % CHECKPOINT_EVERY === 0) checkpoint(n);
  }
  checkpoint(-1);
  return { name: sc.name, checkpoints };
}

function deals() {
  return LAYOUTS.map((meta) => ({
    layout: meta.id,
    deals: DEAL_SEEDS.map((seed) => {
      const g = createGame(getLayout(meta.id), seed);
      return { seed, dealId: g.dealId, tiles: sha(canonical(g.tiles)) };
    }),
  }));
}

type Recorded = { deals: ReturnType<typeof deals>; replays: ReturnType<typeof replay>[] };

const UPDATE = process.env.UPDATE_GOLDEN === "1";

describe("Mahjong golden seeded replay", () => {
  let golden: Recorded | null = null;
  const recorded: Partial<Recorded> & { replays: ReturnType<typeof replay>[] } = { replays: [] };

  beforeAll(() => {
    if (!UPDATE) golden = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as Recorded;
  });

  beforeEach(() => {
    jest.spyOn(Date, "now").mockReturnValue(NOW);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    // Re-record only from a full run, so a filtered run can never write a partial fixture.
    if (!UPDATE || !recorded.deals || recorded.replays.length !== SCENARIOS.length) return;
    fs.mkdirSync(path.dirname(FIXTURE), { recursive: true });
    fs.writeFileSync(FIXTURE, JSON.stringify(recorded, null, 2) + "\n");
  });

  it("deals every layout exactly as recorded (seeds 0-4)", () => {
    const got = deals();
    recorded.deals = got;
    if (!UPDATE) expect(got).toEqual(golden!.deals);
  });

  it.each(SCENARIOS.map((sc) => [sc.name, sc] as const))(
    "replays %s exactly as recorded",
    (_name, sc) => {
      const got = replay(sc);
      recorded.replays[SCENARIOS.indexOf(sc)] = got;
      if (!UPDATE) expect(got).toEqual(golden!.replays.find((r) => r.name === sc.name));
    }
  );

  it("the scripted replays exercise matches, shuffles, undos and a finished board", () => {
    // Guards the script itself: a fixture of four untouched boards would prove little.
    const all = SCENARIOS.map(replay);
    const ends = all.map((r) => r.checkpoints.at(-1)!);
    expect(ends.every((c) => (c.pairsRemoved as number) > 10)).toBe(true);
    expect(ends.some((c) => (c.shufflesLeft as number) < 3)).toBe(true);
    expect(ends.some((c) => c.isComplete === true || c.isDeadlocked === true)).toBe(true);
  });
});
