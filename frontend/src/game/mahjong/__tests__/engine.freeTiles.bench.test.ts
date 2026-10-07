/**
 * Micro-benchmark for #2962: the free-tile work of a 144-tile board, the old way (`isFreeTile`
 * per tile, O(n²)) against the position index (`freeTileIds`, O(n)).
 *
 * Two measurements per board:
 * - the free set alone: one scan against one index build;
 * - one tap's free-tile work: before #2962 the canvas built the free set, its matches and its
 *   pair check from scratch, the screen ran its own pair check and `selectTile` checked the
 *   tile and searched the new board, five O(n²) scans in all; now the screen builds the free
 *   set once per board and passes it to the canvas, the pair check and `selectTile`.
 *
 * The timing is printed, never asserted — it depends on the machine and on V8's JIT (the
 * scan's tight loops suit a JIT; Hermes interprets its bytecode, where the scan's 2n² loop
 * iterations cost relatively more) — so the test is deterministic. What is asserted is that
 * both ways give the same free set, matches and answer on every board measured.
 *
 * By default it runs 50 rounds (well under a second, so it stays enabled in CI; the timings
 * are then rough). For numbers worth quoting, run 2,000 rounds on their own:
 *   cd frontend && MAHJONG_BENCH=1 npx jest src/game/mahjong/__tests__/engine.freeTiles.bench.test.ts
 */
import {
  createGame,
  freeTileIds,
  getAnyFreePair,
  getMatchingFreeTileIds,
  hasFreePairs,
  isFreeTile,
} from "../engine";
import { TURTLE_LAYOUT } from "../layouts/turtle";
import type { MahjongState, SlotTile } from "../types";

const ROUNDS = process.env.MAHJONG_BENCH === "1" ? 2_000 : 50;

/** The free set as every caller built it before #2962: `isFreeTile` for each tile. */
function freeByScan(tiles: readonly SlotTile[]): Set<number> {
  return new Set(tiles.filter((t) => isFreeTile(t, tiles)).map((t) => t.id));
}

/** One tap's free-tile work before #2962: five scans (see the header). */
function tapBefore(s: MahjongState): number {
  const canvasFree = freeByScan(s.tiles);
  const matches = getMatchingFreeTileIds(s, freeByScan(s.tiles));
  const canvasPairs = hasFreePairs(s.tiles, freeByScan(s.tiles));
  const screenPairs = hasFreePairs(s.tiles, freeByScan(s.tiles));
  const tapped = s.tiles.find((t) => isFreeTile(t, s.tiles))!;
  const next = s.tiles.filter((t) => t.id !== tapped.id);
  const deadlock = !hasFreePairs(next, freeByScan(next));
  return canvasFree.size + matches.size + +canvasPairs + +screenPairs + +deadlock;
}

/** The same tap now: one index build, shared (the deadlock search runs only with no shuffles). */
function tapAfter(s: MahjongState): number {
  const free = freeTileIds(s.tiles);
  const matches = getMatchingFreeTileIds(s, free);
  const pairs = hasFreePairs(s.tiles, free);
  const tapped = s.tiles.find((t) => free.has(t.id))!;
  const next = s.tiles.filter((t) => t.id !== tapped.id);
  const deadlock = !hasFreePairs(next);
  return free.size + matches.size + +pairs + +pairs + +deadlock;
}

/** Mean µs per call over ROUNDS, after a warm-up of the same size. */
function microsPer(run: () => number): { us: number; sink: number } {
  let sink = 0;
  for (let i = 0; i < ROUNDS; i++) sink += run();
  const t0 = performance.now();
  for (let i = 0; i < ROUNDS; i++) sink += run();
  return { us: ((performance.now() - t0) / ROUNDS) * 1000, sink };
}

describe("free-tile micro-benchmark (#2962)", () => {
  // The deal, and the board 20 pairs in, each with a free tile selected.
  const dealt = createGame(TURTLE_LAYOUT, 2962);
  let played: MahjongState = dealt;
  for (let n = 0; n < 20; n++) {
    const pair = getAnyFreePair(played.tiles)!;
    played = { ...played, tiles: played.tiles.filter((t) => !pair.includes(t.id)) };
  }
  const withSelection = (s: MahjongState): MahjongState => ({
    ...s,
    selected: s.tiles.find((t) => isFreeTile(t, s.tiles))!,
  });

  it.each([
    ["144-tile deal", withSelection(dealt)],
    ["104 tiles, 20 pairs in", withSelection(played)],
  ] as const)("index vs per-tile scan on the %s", (label, s) => {
    // Same answers first, so the timings compare equal work.
    const byIndex = freeTileIds(s.tiles);
    const byScan = freeByScan(s.tiles);
    expect([...byIndex].sort((a, b) => a - b)).toEqual([...byScan].sort((a, b) => a - b));
    expect([...getMatchingFreeTileIds(s, byIndex)]).toEqual([...getMatchingFreeTileIds(s, byScan)]);
    expect(tapAfter(s)).toBe(tapBefore(s));

    const scan = microsPer(() => freeByScan(s.tiles).size);
    const index = microsPer(() => freeTileIds(s.tiles).size);
    const before = microsPer(() => tapBefore(s));
    const after = microsPer(() => tapAfter(s));
    process.stdout.write(
      `[bench #2962] ${label} (${s.tiles.length} tiles, ${byIndex.size} free), ` +
        `${ROUNDS} rounds: free set scan ${scan.us.toFixed(1)} µs vs index ` +
        `${index.us.toFixed(1)} µs (${(scan.us / index.us).toFixed(1)}x); one tap ` +
        `${before.us.toFixed(1)} µs vs ${after.us.toFixed(1)} µs ` +
        `(${(before.us / after.us).toFixed(1)}x)\n`
    );
    expect(index.sink).toBe(scan.sink);
    expect(after.sink).toBe(before.sink);
  });
});
