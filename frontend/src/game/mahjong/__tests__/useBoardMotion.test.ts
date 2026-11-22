/**
 * useBoardMotion (#3613): each event starts its animation once, on the tiles it moves, and
 * drops it when it ends; Reduce Motion and a restored game start nothing; a new deal drops
 * in, and a tap can skip it; a win holds the result card back for the cascade.
 */
import { act, renderHook } from "@testing-library/react-native";

import { createGame, freeTileIds, selectTile, shuffleBoard } from "../engine";
import { getLayout } from "../layouts/registry";
import type { BoardCamera } from "../layout";
import type { MahjongEvent, MahjongState, SlotTile } from "../types";
import { useBoardMotion } from "../useBoardMotion";
import {
  DEADLOCK_DIM_MS,
  DEAL_IN_MS,
  DESELECT_SETTLE_MS,
  HINT_BREATHE_MS,
  MATCH_MS,
  SELECT_LIFT_MS,
  SHUFFLE_MS,
  WIN_CASCADE_MS,
} from "../motion";

const camera: BoardCamera = {
  tileToScreen: (col, row, layer) => ({
    x: 10 + col * 10 + layer * 4,
    y: 10 + row * 30 - layer * 4,
  }),
  tileWidth: 22,
  tileHeight: 32,
  faceWidth: 18,
  faceHeight: 28,
  sideWidth: 4,
  boardWidth: 400,
  boardHeight: 300,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  viewportWidth: 400,
  viewportHeight: 300,
};

const game = createGame(getLayout("turtle"), 3);
const NO_HINT: ReadonlySet<number> = new Set();

/** Two free tiles that match, and one free tile that matches neither. */
function freeTiles() {
  const free = freeTileIds(game.tiles);
  const tiles = game.tiles.filter((t) => free.has(t.id));
  for (const a of tiles) {
    const b = tiles.find((t) => t !== a && t.faceId === a.faceId);
    const c = tiles.find((t) => t.faceId !== a.faceId);
    if (b && c) return { a, b, c };
  }
  throw new Error("no free pair");
}
const { a, b, c } = freeTiles();

type Props = { s: MahjongState | null; hint: ReadonlySet<number>; rm: boolean };

async function setup(initial: MahjongState | null = game, reduce = false) {
  return renderHook(({ s, hint, rm }: Props) => useBoardMotion(s, hint, camera, rm), {
    initialProps: { s: initial, hint: NO_HINT, rm: reduce },
  });
}
type Hook = Awaited<ReturnType<typeof setup>>;

const withEvents = (s: MahjongState, ...events: MahjongEvent[]): MahjongState => ({
  ...s,
  events,
});
const motionOf = (hook: Hook, id: number) => hook.result.current.motion.tiles.get(id);
const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

beforeEach(() => {
  jest.useFakeTimers();
});
afterEach(() => {
  jest.useRealTimers();
});

describe("useBoardMotion — select, mismatch and deselect", () => {
  it("a select lifts the tile, and the lift ends after SELECT_LIFT_MS", async () => {
    const hook = await setup();
    const s1 = selectTile(game, a.id);
    await hook.rerender({ s: s1, hint: NO_HINT, rm: false });
    expect(motionOf(hook, a.id)?.lift).toMatchObject({ from: 0, to: 1, duration: SELECT_LIFT_MS });
    expect(motionOf(hook, a.id)?.shake).toBeUndefined();
    await advance(SELECT_LIFT_MS);
    expect(motionOf(hook, a.id)).toBeUndefined();
  });

  it("a wrong pair: the new tile lifts and shakes, the old one settles", async () => {
    const hook = await setup();
    const s1 = selectTile(game, a.id);
    await hook.rerender({ s: s1, hint: NO_HINT, rm: false });
    const s2 = selectTile(s1, c.id);
    await hook.rerender({ s: s2, hint: NO_HINT, rm: false });
    expect(motionOf(hook, c.id)?.lift).toMatchObject({ from: 0, to: 1 });
    expect(motionOf(hook, c.id)?.shake).toBeDefined();
    expect(motionOf(hook, a.id)?.lift).toMatchObject({ from: 1, to: 0 });
  });

  it("a deselect settles the tile back", async () => {
    const hook = await setup();
    const s1 = selectTile(game, a.id);
    await hook.rerender({ s: s1, hint: NO_HINT, rm: false });
    await advance(SELECT_LIFT_MS);
    await hook.rerender({ s: selectTile(s1, a.id), hint: NO_HINT, rm: false });
    expect(motionOf(hook, a.id)?.lift).toMatchObject({ from: 1, to: 0 });
    await advance(DESELECT_SETTLE_MS);
    expect(motionOf(hook, a.id)).toBeUndefined();
  });
});

describe("useBoardMotion — match, hint, shuffle, deadlock", () => {
  it("a match leaves a ghost pair that flies and bursts, then goes", async () => {
    const hook = await setup();
    const s1 = selectTile(game, a.id);
    await hook.rerender({ s: s1, hint: NO_HINT, rm: false });
    const s2 = selectTile(s1, b.id);
    await hook.rerender({ s: s2, hint: NO_HINT, rm: false });
    const [ghost] = hook.result.current.motion.ghosts;
    expect(ghost?.tiles.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    // The matched tiles are off the board: no lift left for them.
    expect(motionOf(hook, a.id)?.lift).toBeUndefined();
    await advance(MATCH_MS);
    expect(hook.result.current.motion.ghosts).toEqual([]);
  });

  it("a hint breathes on its pair while it shows, and stops with it", async () => {
    const hook = await setup();
    const pair = new Set([a.id, b.id]);
    await hook.rerender({ s: game, hint: pair, rm: false });
    expect(motionOf(hook, a.id)?.hint?.duration).toBe(HINT_BREATHE_MS);
    expect(motionOf(hook, b.id)?.hint).toBeDefined();
    await hook.rerender({ s: game, hint: NO_HINT, rm: false });
    expect(motionOf(hook, a.id)).toBeUndefined();
  });

  it("a shuffle swirls every tile from where its face was", async () => {
    const hook = await setup();
    const shuffled = shuffleBoard(game);
    await hook.rerender({ s: shuffled, hint: NO_HINT, rm: false });
    for (const t of shuffled.tiles) {
      const sh = motionOf(hook, t.id)?.shuffle;
      expect(sh).toBeDefined();
      const to = camera.tileToScreen(t.col, t.row, t.layer);
      // Its start is the place of an old tile with the same face.
      const from = { x: to.x + sh!.fromX, y: to.y + sh!.fromY };
      expect(
        game.tiles.some((o: SlotTile) => {
          const p = camera.tileToScreen(o.col, o.row, o.layer);
          return o.faceId === t.faceId && p.x === from.x && p.y === from.y;
        })
      ).toBe(true);
    }
    await advance(SHUFFLE_MS);
    expect(hook.result.current.motion.tiles.size).toBe(0);
  });

  it("a deadlock dims the locked tiles only, briefly", async () => {
    const hook = await setup();
    await hook.rerender({
      s: withEvents({ ...game, isDeadlocked: true }, { type: "deadlock" }),
      hint: NO_HINT,
      rm: false,
    });
    const free = freeTileIds(game.tiles);
    for (const t of game.tiles) {
      expect(motionOf(hook, t.id)?.dim !== undefined).toBe(!free.has(t.id));
    }
    await advance(DEADLOCK_DIM_MS);
    expect(hook.result.current.motion.tiles.size).toBe(0);
  });
});

describe("useBoardMotion — deal-in and win", () => {
  it("a new deal drops in layer by layer; a tap can end it at once", async () => {
    const hook = await setup();
    const next = createGame(getLayout("turtle"), 4);
    await act(async () => {
      hook.result.current.dealIn(next);
    });
    await hook.rerender({ s: next, hint: NO_HINT, rm: false });
    expect(hook.result.current.dealing()).toBe(true);
    expect(motionOf(hook, next.tiles[0]!.id)?.deal?.duration).toBe(DEAL_IN_MS);
    const top = next.tiles.reduce((m, t) => (t.layer > m.layer ? t : m));
    const bottom = next.tiles.find((t) => t.layer === 0)!;
    expect(motionOf(hook, top.id)!.deal!.delay).toBeGreaterThan(
      motionOf(hook, bottom.id)!.deal!.delay
    );
    await act(async () => {
      hook.result.current.skipDeal();
    });
    expect(hook.result.current.dealing()).toBe(false);
    expect(hook.result.current.motion.tiles.size).toBe(0);
  });

  it("a deal ends by itself after DEAL_IN_MS, and a board not dealt in starts still", async () => {
    const hook = await setup(null);
    const next = createGame(getLayout("turtle"), 4);
    await act(async () => {
      hook.result.current.dealIn(next);
    });
    await hook.rerender({ s: next, hint: NO_HINT, rm: false });
    await advance(DEAL_IN_MS);
    expect(hook.result.current.dealing()).toBe(false);
    expect(hook.result.current.motion.tiles.size).toBe(0);
    // Another board (a restored save) with no dealIn: nothing moves.
    await hook.rerender({ s: game, hint: NO_HINT, rm: false });
    expect(hook.result.current.motion.tiles.size).toBe(0);
  });

  it("a cleared board plays the cascade, holding the result card back until it ends", async () => {
    const hook = await setup();
    const won = withEvents(
      { ...game, tiles: [], isComplete: true },
      { type: "tileMatch", tiles: [a, b] },
      { type: "boardCleared" }
    );
    await hook.rerender({ s: won, hint: NO_HINT, rm: false });
    expect(hook.result.current.celebrating).toBe(true);
    expect(hook.result.current.motion.cascade).not.toBeNull();
    await advance(WIN_CASCADE_MS);
    expect(hook.result.current.celebrating).toBe(false);
    expect(hook.result.current.motion.cascade).toBeNull();
  });
});

describe("useBoardMotion — no frame out of place", () => {
  it("a new deal is dropping in from the first render that shows it", async () => {
    const next = createGame(getLayout("turtle"), 4);
    const seen: boolean[] = [];
    const hook = await renderHook(
      ({ s }: { s: MahjongState }) => {
        const m = useBoardMotion(s, NO_HINT, camera, false);
        if (s === next) seen.push(m.motion.tiles.get(next.tiles[0]!.id)?.deal !== undefined);
        return m;
      },
      { initialProps: { s: game } }
    );
    // As the screen does: the deal set up with the setState that shows the board.
    await act(async () => {
      hook.result.current.dealIn(next);
      await hook.rerender({ s: next });
    });
    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every(Boolean)).toBe(true);
  });

  it("an undo (the tiles change with no match or shuffle) stops what was moving", async () => {
    const hook = await setup();
    const s1 = selectTile(game, a.id);
    await hook.rerender({ s: s1, hint: NO_HINT, rm: false });
    expect(motionOf(hook, a.id)).toBeDefined();
    await hook.rerender({
      s: { ...s1, tiles: [...s1.tiles], events: undefined },
      hint: NO_HINT,
      rm: false,
    });
    expect(hook.result.current.motion.tiles.size).toBe(0);
  });
});

describe("useBoardMotion — the result card waits from the first render of a win", () => {
  it("no render shows a cleared board with the card free to show before the cascade ends", async () => {
    const seen: { complete: boolean; celebrating: boolean }[] = [];
    const hook = await renderHook(
      ({ s }: { s: MahjongState }) => {
        const m = useBoardMotion(s, NO_HINT, camera, false);
        seen.push({ complete: s.isComplete, celebrating: m.celebrating });
        return m;
      },
      { initialProps: { s: game } }
    );
    const won = withEvents(
      { ...game, tiles: [], isComplete: true },
      { type: "tileMatch", tiles: [a, b] },
      { type: "boardCleared" }
    );
    await hook.rerender({ s: won });
    // Every render of the cleared board, from its very first, holds the card back.
    expect(seen.filter((r) => r.complete).every((r) => r.celebrating)).toBe(true);
    await advance(WIN_CASCADE_MS);
    expect(hook.result.current.celebrating).toBe(false);
  });
});

describe("useBoardMotion — Reduce Motion and restored games", () => {
  it("under Reduce Motion nothing animates: every change is instant", async () => {
    const hook = await setup(game, true);
    const s1 = selectTile(game, a.id);
    await hook.rerender({ s: s1, hint: new Set([b.id]), rm: true });
    await hook.rerender({ s: selectTile(s1, b.id), hint: NO_HINT, rm: true });
    await hook.rerender({ s: shuffleBoard(game), hint: NO_HINT, rm: true });
    const won = withEvents({ ...game, tiles: [], isComplete: true }, { type: "boardCleared" });
    await hook.rerender({ s: won, hint: NO_HINT, rm: true });
    const next = createGame(getLayout("turtle"), 4);
    await act(async () => {
      hook.result.current.dealIn(next);
    });
    await hook.rerender({ s: next, hint: NO_HINT, rm: true });
    expect(hook.result.current.motion.tiles.size).toBe(0);
    expect(hook.result.current.motion.ghosts).toEqual([]);
    expect(hook.result.current.motion.cascade).toBeNull();
    expect(hook.result.current.celebrating).toBe(false);
    expect(hook.result.current.dealing()).toBe(false);
  });

  it("a win under Reduce Motion keeps its card when the setting is then turned off", async () => {
    const hook = await setup(game, true);
    const won = withEvents(
      { ...game, tiles: [], isComplete: true },
      { type: "tileMatch", tiles: [a, b] },
      { type: "boardCleared" }
    );
    await hook.rerender({ s: won, hint: NO_HINT, rm: true });
    expect(hook.result.current.celebrating).toBe(false);
    await hook.rerender({ s: won, hint: NO_HINT, rm: false });
    expect(hook.result.current.celebrating).toBe(false);
    await advance(WIN_CASCADE_MS * 2);
    expect(hook.result.current.celebrating).toBe(false);
  });

  it("a restored game, with a selection and a finished board, replays nothing", async () => {
    const hook = await setup(null);
    await hook.rerender({ s: { ...game, selected: a }, hint: NO_HINT, rm: false });
    await hook.rerender({ s: { ...game, tiles: [], isComplete: true }, hint: NO_HINT, rm: false });
    expect(hook.result.current.motion.tiles.size).toBe(0);
    expect(hook.result.current.celebrating).toBe(false);
  });
});
