/**
 * useBoardMotion (#3613): the board's animations, as data the canvases draw.
 *
 * Each engine event (and a new deal, and a hint) starts one or more animation clocks
 * (`MotionClock`, a progress from 0 to 1) and records which tiles they move:
 *
 *   - a select lifts the tile; the tile it replaces settles back, as does a deselected tile;
 *   - a non-matching second tap also shakes the new tile "no";
 *   - a match leaves a ghost pair that flies together and bursts (`ghosts`);
 *   - a hint breathes on its pair;
 *   - a new deal drops in layer by layer (`dealIn`), which a tap skips (`skipDeal`);
 *   - a shuffle swirls each tile from where its face was to its new place;
 *   - a cleared board grows the last burst into a cascade (`cascade`), and holds the result
 *     card back while it plays (`celebrating`);
 *   - a deadlock dims the locked tiles briefly.
 *
 * The records change once per event (and once more when each animation ends), never per
 * frame: the progress values move on the UI thread. Under Reduce Motion nothing is started,
 * so every change is instant. A restored game carries no events, so it replays nothing.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { Easing, makeMutable, withTiming } from "react-native-reanimated";

import type { BoardCamera } from "./layout";
import { freeTileIds } from "./engine";
import type { MahjongState, SlotTile } from "./types";
import { useGameEvents } from "../_shared/useGameEvents";
import {
  DEADLOCK_DIM_MS,
  DEAL_IN_MS,
  DESELECT_SETTLE_MS,
  HINT_BREATHE_MS,
  MATCH_MS,
  MISMATCH_SHAKE_MS,
  SELECT_LIFT_MS,
  SHUFFLE_MS,
  WIN_CASCADE_MS,
  dealDelay,
  shuffleDelay,
} from "./motion";
import type { MotionClock, TileMotion } from "./motion";

/** A matched pair after it left the board: drawn on top until its burst ends. */
export interface MatchGhost {
  readonly key: string;
  readonly tiles: readonly [SlotTile, SlotTile];
  readonly clock: MotionClock;
}

/** The win cascade: from the last pair's meeting point. */
export interface WinCascade {
  readonly clock: MotionClock;
  readonly x: number;
  readonly y: number;
}

export interface BoardMotion {
  /** Each animating tile's motion, by id; a tile not here is at rest. */
  readonly tiles: ReadonlyMap<number, TileMotion>;
  readonly ghosts: readonly MatchGhost[];
  readonly cascade: WinCascade | null;
}

type Channel = keyof TileMotion;

const EMPTY: BoardMotion = { tiles: new Map(), ghosts: [], cascade: null };

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** A new clock, running from 0 to 1 over `duration` ms on the UI thread. */
function startClock(duration: number): MotionClock {
  const progress = makeMutable(0);
  progress.value = withTiming(1, { duration, easing: Easing.linear });
  return { progress, t0: now(), duration };
}

/** `motion` with `channel` set on each of `ids` (to `value(id)`, or removed when undefined). */
function withChannel(
  motion: BoardMotion,
  ids: Iterable<number>,
  channel: Channel,
  value: (id: number) => TileMotion[Channel] | undefined
): BoardMotion {
  const tiles = new Map(motion.tiles);
  for (const id of ids) {
    const next: Record<string, unknown> = { ...(tiles.get(id) ?? {}) };
    const v = value(id);
    if (v === undefined) delete next[channel];
    else next[channel] = v;
    if (Object.keys(next).length === 0) tiles.delete(id);
    else tiles.set(id, next as TileMotion);
  }
  return { ...motion, tiles };
}

/** `motion` without `channel` wherever it is still `clock` (a later one is kept). */
function withoutClock(motion: BoardMotion, channel: Channel, clock: MotionClock): BoardMotion {
  const ids: number[] = [];
  for (const [id, m] of motion.tiles) {
    if ((m[channel] as MotionClock | undefined)?.progress === clock.progress) ids.push(id);
  }
  return ids.length === 0 ? motion : withChannel(motion, ids, channel, () => undefined);
}

/**
 * Where each tile of the new board came from: the place of an old tile with the same face,
 * as an offset in board units from its new place.
 */
function shuffleOrigins(
  before: readonly SlotTile[],
  after: readonly SlotTile[],
  camera: BoardCamera
): Map<number, { fromX: number; fromY: number }> {
  const byFace = new Map<number, { x: number; y: number }[]>();
  for (const t of before) {
    const list = byFace.get(t.faceId) ?? [];
    list.push(camera.tileToScreen(t.col, t.row, t.layer));
    byFace.set(t.faceId, list);
  }
  const out = new Map<number, { fromX: number; fromY: number }>();
  for (const t of after) {
    const to = camera.tileToScreen(t.col, t.row, t.layer);
    const from = byFace.get(t.faceId)?.pop() ?? to;
    out.set(t.id, { fromX: from.x - to.x, fromY: from.y - to.y });
  }
  return out;
}

export function useBoardMotion(
  state: MahjongState | null,
  hintIds: ReadonlySet<number>,
  camera: BoardCamera,
  reduceMotion: boolean
) {
  const [motion, setMotion] = useState<BoardMotion>(EMPTY);
  const [celebrating, setCelebrating] = useState(false);
  const timers = useRef(new Set<ReturnType<typeof setTimeout>>());
  // The state the last render saw: what a select replaced, what a shuffle moved.
  const prevRef = useRef<MahjongState | null>(state);
  const pendingDeal = useRef<string | null>(null);
  const dealClock = useRef<MotionClock | null>(null);

  const later = useCallback((ms: number, fn: () => void) => {
    const id = setTimeout(() => {
      timers.current.delete(id);
      fn();
    }, ms);
    timers.current.add(id);
  }, []);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const id of pending) clearTimeout(id);
      pending.clear();
    };
  }, []);

  /** Start `channel` on `ids` for `ms`, and drop it again when it ends. */
  const animate = useCallback(
    (
      ids: Iterable<number>,
      channel: Channel,
      ms: number,
      extra: (id: number, clock: MotionClock) => object = () => ({})
    ) => {
      const clock = startClock(ms);
      setMotion((m) => withChannel(m, ids, channel, (id) => ({ ...clock, ...extra(id, clock) })));
      later(ms, () => setMotion((m) => withoutClock(m, channel, clock)));
      return clock;
    },
    [later]
  );

  const lift = useCallback(
    (id: number, from: number, to: number) =>
      animate([id], "lift", to > from ? SELECT_LIFT_MS : DESELECT_SETTLE_MS, () => ({ from, to })),
    [animate]
  );

  useGameEvents(state?.events, {
    tileSelect: (e) => {
      if (reduceMotion || !state?.selected) return;
      const prev = prevRef.current?.selected ?? null;
      lift(state.selected.id, 0, 1);
      if (prev && prev.id !== state.selected.id) lift(prev.id, 1, 0);
      if (e.mismatch) animate([state.selected.id], "shake", MISMATCH_SHAKE_MS);
    },
    tileMatch: ({ tiles }) => {
      if (reduceMotion) return;
      const clock = startClock(MATCH_MS);
      const key = `${clock.t0}-${tiles[0].id}-${tiles[1].id}`;
      setMotion((m) => ({
        ...withChannel(m, [tiles[0].id, tiles[1].id], "lift", () => undefined),
        ghosts: [...m.ghosts, { key, tiles, clock }],
      }));
      later(MATCH_MS, () =>
        setMotion((m) => ({ ...m, ghosts: m.ghosts.filter((g) => g.key !== key) }))
      );
    },
    shuffle: () => {
      if (reduceMotion || !state) return;
      const before = prevRef.current?.tiles ?? [];
      const origins = shuffleOrigins(before, state.tiles, camera);
      // A wave from left to right.
      const order = [...state.tiles].sort((a, b) => a.col - b.col || a.row - b.row);
      const rank = new Map(order.map((t, i) => [t.id, i]));
      animate(
        state.tiles.map((t) => t.id),
        "shuffle",
        SHUFFLE_MS,
        (id) => ({
          delay: shuffleDelay(rank.get(id) ?? 0, order.length),
          ...(origins.get(id) ?? { fromX: 0, fromY: 0 }),
        })
      );
    },
    boardCleared: () => {
      if (reduceMotion) return;
      const pair = state?.events?.find((e) => e.type === "tileMatch");
      let x = camera.boardWidth / 2;
      let y = camera.boardHeight / 2;
      if (pair?.type === "tileMatch") {
        const a = camera.tileToScreen(pair.tiles[0].col, pair.tiles[0].row, pair.tiles[0].layer);
        const b = camera.tileToScreen(pair.tiles[1].col, pair.tiles[1].row, pair.tiles[1].layer);
        x = (a.x + b.x + camera.faceWidth) / 2;
        y = (a.y + b.y + camera.faceHeight) / 2;
      }
      const clock = startClock(WIN_CASCADE_MS);
      setMotion((m) => ({ ...m, cascade: { clock, x, y } }));
      setCelebrating(true);
      later(WIN_CASCADE_MS, () => {
        setMotion((m) => (m.cascade?.clock === clock ? { ...m, cascade: null } : m));
        setCelebrating(false);
      });
    },
    deadlock: () => {
      if (reduceMotion || !state) return;
      const free = freeTileIds(state.tiles);
      animate(
        state.tiles.filter((t) => !free.has(t.id)).map((t) => t.id),
        "dim",
        DEADLOCK_DIM_MS
      );
    },
  });

  const selectedId = state?.selected?.id ?? null;
  const tiles = state?.tiles;
  const dealId = state?.dealId;
  useEffect(() => {
    const prev = prevRef.current;
    prevRef.current = state;
    if (!state || reduceMotion) return;
    // A new board starts with no motion, or with its deal (which may follow no board at all).
    if (!prev || prev.dealId !== state.dealId) {
      setMotion(EMPTY);
      setCelebrating(false);
      if (pendingDeal.current === state.dealId) {
        pendingDeal.current = null;
        const layers = state.tiles.reduce((n, t) => Math.max(n, t.layer + 1), 1);
        const layerOf = new Map(state.tiles.map((t) => [t.id, t.layer]));
        dealClock.current = animate(
          state.tiles.map((t) => t.id),
          "deal",
          DEAL_IN_MS,
          (id) => ({ delay: dealDelay(layerOf.get(id) ?? 0, layers) })
        );
        const clock = dealClock.current;
        later(DEAL_IN_MS, () => {
          if (dealClock.current === clock) dealClock.current = null;
        });
      }
      return;
    }
    // A deselect (the same board, no event): the tile settles back.
    const prevSel = prev.selected;
    if (prevSel && selectedId === null && state.events === undefined && prev.tiles === tiles) {
      lift(prevSel.id, 1, 0);
    }
    // Reads the latest state; only these changes start anything.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, tiles, dealId]);

  // The hint breathes while it shows; it ends with it.
  const hintClock = useRef<MotionClock | null>(null);
  useEffect(() => {
    if (hintClock.current) {
      const old = hintClock.current;
      hintClock.current = null;
      setMotion((m) => withoutClock(m, "hint", old));
    }
    if (reduceMotion || hintIds.size === 0) return;
    hintClock.current = animate(hintIds, "hint", HINT_BREATHE_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hintIds]);

  /** The next board with this deal id drops in (a new game). */
  const dealIn = useCallback(
    (id: string) => {
      if (!reduceMotion) pendingDeal.current = id;
    },
    [reduceMotion]
  );

  /** Whether the deal is still dropping in (a tap then skips it instead of selecting). */
  const dealing = useCallback(() => dealClock.current !== null, []);

  /** Ends the deal at once. */
  const skipDeal = useCallback(() => {
    const clock = dealClock.current;
    if (!clock) return;
    dealClock.current = null;
    clock.progress.value = 1;
    setMotion((m) => withoutClock(m, "deal", clock));
  }, []);

  return { motion, celebrating, dealIn, dealing, skipDeal };
}
