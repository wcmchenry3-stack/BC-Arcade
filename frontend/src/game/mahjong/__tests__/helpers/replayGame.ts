/**
 * Test helpers for Mahjong replay recording (#3285): a scripted, seeded game
 * played through the real engine and recorded the way the screen records it,
 * and the rebuild of a game from its recorded events alone.
 */

import type { EnqueueEventInput } from "../../../_shared/gameEventClient";
import { GameRecorder } from "../../../_shared/gameRecorder";
import {
  createGame,
  createSeededRng,
  dealEventData,
  freeTileIds,
  getAllFreePairs,
  getAnyFreePair,
  selectTile,
  setRng,
  shuffleBoard,
  tilesMatch,
  undoMove,
} from "../../engine";
import { getLayout } from "../../layouts/registry";
import { MahjongReplay, type MoveEntry } from "../../replay";
import type { MahjongState, SlotTile } from "../../types";

/** What `game_started` carries for a deal (#3281). */
export interface StartData {
  readonly layout: string;
  readonly seed: number;
}

/** A `MahjongReplay` over a real recorder with a fake sink, as the screen wires it. */
export function wiredReplay(
  chunkSize?: number,
  forward?: (events: readonly EnqueueEventInput[]) => void
): {
  replay: MahjongReplay;
  recorder: GameRecorder<"mahjong">;
  /** Every event the recorder saved, in order. */
  saved: EnqueueEventInput[];
  /** The recorder's idle tasks, waiting for the test to run them. */
  tasks: (() => void)[];
} {
  const saved: EnqueueEventInput[] = [];
  const tasks: (() => void)[] = [];
  const recorder = new GameRecorder<"mahjong">({
    gameType: "mahjong",
    sink: {
      canAccept: () => true,
      enqueueMany: (events) => {
        saved.push(...events);
        forward?.(events);
        return true;
      },
    },
    schedule: (task) => tasks.push(task),
  });
  recorder.startSession();
  const replay = new MahjongReplay(
    {
      isOpen: () => true,
      beginUnit: (n) => recorder.beginUnit(n),
      record: (type, data) => recorder.record(type, data),
      closeUnit: () => recorder.closeUnit(),
      flush: () => recorder.flush(),
    },
    chunkSize
  );
  return { replay, recorder, saved, tasks };
}

export interface Script {
  readonly layout: string;
  readonly seed: number;
  /** Seed of the RNG the shuffles draw from (the engine's global one). */
  readonly shuffleSeed?: number;
  /** Stop after this many steps (default: play on to a clear or a deadlock). */
  readonly maxSteps?: number;
  /** Chunk size (default: the screen's). */
  readonly chunkSize?: number;
  /** Also receives every batch the recorder saves (a real queue, for the benchmark). */
  readonly forward?: (events: readonly EnqueueEventInput[]) => void;
}

export interface ScriptedGame {
  readonly start: StartData;
  readonly opening: MahjongState;
  readonly final: MahjongState;
  /** Every `moves` event the recorder saved, in order. */
  readonly saved: EnqueueEventInput[];
  /** Every entry recorded, in order (the saved events' `m`, flattened). */
  readonly entries: MoveEntry[];
  /** How many of each action the script took. */
  readonly counts: { matches: number; undos: number; hints: number; shuffles: number };
}

/**
 * Plays a scripted game and records it as the screen does: the engine's events
 * of each action answer `tileMatch` and `shuffle`; an undo with something to
 * take back, and a hint that found a pair, are recorded by their handlers.
 *
 * The script: a pair per step (picked from the free pairs by the step number),
 * sometimes after a tap on a free tile that does not match; a hint every 7th
 * step; a shuffle at steps 10, 30 and 31; an undo at steps 15, 32 and 40 (the
 * one at 32 takes back the shuffle of 31).
 */
export function playScripted(script: Script): ScriptedGame {
  const steps = playSteps(script);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
  }
}

/**
 * `playScripted` with an idle moment after every step: the recorder's idle
 * tasks run, then `idle` is awaited (the benchmark lets its storage mock settle).
 */
export async function playScriptedWithIdle(
  script: Script,
  idle: () => Promise<void>
): Promise<ScriptedGame> {
  const steps = playSteps(script);
  for (;;) {
    const next = steps.next();
    if (next.done) return next.value;
    await idle();
  }
}

function* playSteps(script: Script): Generator<void, ScriptedGame> {
  setRng(createSeededRng(script.shuffleSeed ?? 99));
  const opening = createGame(getLayout(script.layout), script.seed);
  const { replay, saved, tasks } = wiredReplay(script.chunkSize, script.forward);
  const counts = { matches: 0, undos: 0, hints: 0, shuffles: 0 };
  let state = opening;

  /** The screen's answer to an action's engine events. */
  const answer = (next: MahjongState): void => {
    for (const event of next.events ?? []) {
      if (event.type === "tileMatch") {
        replay.match(event.tiles);
        counts.matches += 1;
      }
      if (event.type === "shuffle") {
        replay.shuffle(next);
        counts.shuffles += 1;
      }
    }
  };
  const doShuffle = (): void => {
    const next = shuffleBoard(state);
    if (next === state) return;
    state = next;
    answer(state);
  };
  const doUndo = (): void => {
    if (state.undoStack.length === 0) return;
    replay.undo();
    counts.undos += 1;
    state = undoMove(state);
  };

  const max = script.maxSteps ?? 1000;
  for (let step = 0; step < max && !state.isComplete && !state.isDeadlocked; step += 1) {
    // The idle moment between steps: the recorder saves what it holds.
    while (tasks.length > 0) tasks.shift()?.();
    yield;
    if (step === 10 || step === 30 || step === 31) {
      doShuffle();
      continue;
    }
    if (step === 15 || step === 32 || step === 40) {
      doUndo();
      continue;
    }
    if (step % 7 === 0 && getAnyFreePair(state.tiles) !== null) {
      replay.hint();
      counts.hints += 1;
    }
    const free = freeTileIds(state.tiles);
    const pairs = getAllFreePairs(state.tiles, free);
    if (pairs.length === 0) {
      if (state.shufflesLeft === 0) break;
      doShuffle();
      continue;
    }
    const [a, b] = pairs[(step * 7) % pairs.length]!;
    // Noise: a tap on a free tile that matches neither, then the pair's first tap replaces it.
    const stray = state.tiles.find((t) => free.has(t.id) && t.id !== a.id && !tilesMatch(t, a));
    state = { ...state, selected: null };
    if (step % 3 === 0 && stray !== undefined) state = selectTile(state, stray.id, free);
    state = selectTile(state, a.id, free);
    state = selectTile(state, b.id, free);
    answer(state);
  }
  replay.flush();
  while (tasks.length > 0) tasks.shift()?.();
  return {
    start: { layout: script.layout, seed: script.seed },
    opening,
    final: state,
    saved,
    entries: saved.flatMap((e) => (e.data as { m: MoveEntry[] }).m),
    counts,
  };
}

/** Why a replay could not follow its events. */
export class ReplayError extends Error {}

/** The suit and rank behind each face id on `tiles`. */
function faceTable(
  tiles: readonly SlotTile[]
): Map<number, Pick<SlotTile, "suit" | "rank" | "faceId">> {
  const out = new Map<number, Pick<SlotTile, "suit" | "rank" | "faceId">>();
  for (const t of tiles) out.set(t.faceId, { suit: t.suit, rank: t.rank, faceId: t.faceId });
  return out;
}

/**
 * One recorded entry applied to `state`. A match is two taps on its tiles; an
 * undo and the bookkeeping of a shuffle (the token spent, the undo entry) are
 * the engine's own; only the order a shuffle produced is taken from the
 * record. Throws `ReplayError` when the entry does not apply to the board.
 */
export function applyEntry(state: MahjongState, entry: MoveEntry): MahjongState {
  if (Array.isArray(entry)) {
    const [a, b] = entry as [number, number];
    const next = selectTile(selectTile({ ...state, selected: null }, a), b);
    if (next.tiles.length !== state.tiles.length - 2) {
      throw new ReplayError(`tiles ${a} and ${b} are not a free pair`);
    }
    return next;
  }
  if (entry === "u") return undoMove(state);
  if (entry === "h") return state; // a hint changes nothing
  const shuffled = shuffleBoard(state);
  if (entry === "s") return shuffled; // the board stays as it was (a geometric deadlock)
  const shape = entry as { s: number[]; f: number[] };
  const faces = faceTable(state.tiles);
  const tiles = shape.s.map((slot, i): SlotTile => {
    const at = state.tiles[slot];
    const face = faces.get(shape.f[i]!);
    if (at === undefined || face === undefined) throw new ReplayError("bad shuffle entry");
    return { ...face, id: i, col: at.col, row: at.row, layer: at.layer };
  });
  return { ...shuffled, tiles };
}

/**
 * Rebuilds a game from `game_started`'s deal fields and the saved `moves`
 * events alone.
 */
export function rebuildGame(start: StartData, events: readonly EnqueueEventInput[]): MahjongState {
  const dealt = dealEventData(start.layout, start.seed) as { layout: string; seed: number };
  let state = createGame(getLayout(dealt.layout), dealt.seed);
  for (const event of events) {
    if (event.type !== "moves") continue;
    for (const entry of (event.data as { m: MoveEntry[] }).m) state = applyEntry(state, entry);
  }
  return state;
}

/** The fields a replay must reproduce: the board and what the engine derives from it. */
export function gameOutcome(state: MahjongState) {
  return {
    tiles: state.tiles,
    score: state.score,
    pairsRemoved: state.pairsRemoved,
    shufflesLeft: state.shufflesLeft,
    isComplete: state.isComplete,
    isDeadlocked: state.isDeadlocked,
    undoDepth: state.undoStack.length,
  };
}
