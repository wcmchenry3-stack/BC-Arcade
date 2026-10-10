/**
 * AsyncStorage persistence for in-progress Mahjong games (#872), through the
 * shared `storageSlot` (#2987).
 *
 * One slot per device; no account linkage in V1. The screen decides when to
 * save (`useMahjongPersistence`: when the board, its undo history or the
 * banked clock change, debounced, #2961).
 *
 * The undo history is stored as deltas (`MahjongUndoEntry`), not board
 * snapshots, so a save stays a few tens of KB however deep the history
 * (#2961). The play clock is saved banked and restarted on load
 * (`clockForSave`, `clockOnLoad`, #2750), so the time the app was closed
 * never counts.
 *
 * `loadGame` reads `_v: 2` saves, and `_v: 1` saves (snapshot undo history)
 * through the `legacyUndo` shim for one release, writing a save it had to
 * normalise back at once as `_v: 2`; any other version is
 * rejected rather than crashing. Corrupt payloads are deleted and reported
 * as a warning — the caller recovers by starting a fresh game. An undo
 * history that doesn't check out only costs the entries from the bad one
 * back (`loadUndoEntries`); the game itself loads.
 *
 * The engine's one-shot `events` (#3087) are never saved and never loaded: a
 * restored game must not replay the feedback of the move before the save.
 * Saves from before them have none, and load as they always did.
 */

import type { LayoutMeta, MahjongState } from "./types";
import { resolveLayoutId } from "./layouts/registry";
import { clockForSave, clockOnLoad } from "../_shared/playClock";
import { plausibleBestMs } from "./engine";
import { migrateLegacyUndoStack } from "./legacyUndo";
import { loadUndoEntries } from "./undoEntries";
import { createJsonSlot, createRecord } from "../_shared/storageSlot";

const SUBSYSTEM = "mahjong.storage";

export interface MahjongStats {
  /**
   * The fastest clear on this device, per layout id (#2747): each layout has
   * its own board, so a fast clear on an easy layout is no best on a hard
   * one. Only clears at or above MAHJONG_MIN_CLEAR_MS count. Saves from
   * before #2747 kept one `bestTimeMs` across every layout; it can't be
   * attributed to a layout, so it is dropped on load (it would otherwise
   * show as a false best on some layout).
   */
  bestTimeMsByLayout: Readonly<Record<string, number>>;
}

/** The stored per-layout bests: plausible numbers only (see `plausibleBestMs`). */
function loadBestTimes(raw: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [layoutId, ms] of Object.entries(raw as Record<string, unknown>)) {
    const best = typeof ms === "number" ? plausibleBestMs(ms) : 0;
    if (best > 0) out[layoutId] = best;
  }
  return out;
}

/** A save as parsed, before `loadGame` has checked and normalised it. */
type ParsedSave = {
  -readonly [K in keyof MahjongState]?: K extends "_v" | "undoStack" ? unknown : MahjongState[K];
};

/**
 * Fill in the fields older builds didn't save; true when any was missing
 * (or, for the layout, unknown), so the save needs writing back.
 */
function fillMissingFields(parsed: ParsedSave): boolean {
  let filled = false;
  // Timer fields: a save without them loads with no play banked (#2750).
  if (parsed.startedAt === undefined) {
    parsed.startedAt = null;
    filled = true;
  }
  if (typeof parsed.accumulatedMs !== "number") {
    parsed.accumulatedMs = 0;
    filled = true;
  }
  // dealId added in #943 — fall back gracefully for saves from older builds
  if (typeof parsed.dealId !== "string") {
    parsed.dealId = "0000";
    filled = true;
  }
  // currentLayoutId added in #1688 — resolveLayoutId() defaults to "turtle" for old saves
  const layoutId = resolveLayoutId(parsed as { currentLayoutId?: string });
  if (layoutId !== parsed.currentLayoutId) filled = true;
  parsed.currentLayoutId = layoutId;
  return filled;
}

function isSavedGame(p: unknown): p is ParsedSave {
  const parsed = p as ParsedSave;
  return !(
    (parsed._v !== 2 && parsed._v !== 1) ||
    !Array.isArray(parsed.tiles) ||
    typeof parsed.pairsRemoved !== "number" ||
    typeof parsed.score !== "number" ||
    typeof parsed.shufflesLeft !== "number" ||
    !Array.isArray(parsed.undoStack) ||
    typeof parsed.isComplete !== "boolean" ||
    typeof parsed.isDeadlocked !== "boolean"
  );
}

/** `state` without its one-shot `events`, so the save holds the game only. */
function withoutEvents(state: MahjongState): MahjongState {
  if (!("events" in state)) return state;
  const { events: _events, ...game } = state;
  return game;
}

async function restore(parsed: ParsedSave): Promise<MahjongState> {
  const legacy = parsed._v === 1;
  // Undo deltas since #2961; a version 1 save's snapshots are converted,
  // then checked like any history, so what is written back is what loads.
  const rawUndo = parsed.undoStack as unknown[];
  const tiles = parsed.tiles as MahjongState["tiles"];
  const undoStack = loadUndoEntries(
    legacy ? migrateLegacyUndoStack(rawUndo, tiles) : rawUndo,
    tiles
  );
  parsed.undoStack = undoStack;
  parsed._v = 2;
  // Transient: a save written with events (none should be) mustn't replay them.
  delete parsed.events;
  const filled = fillMissingFields(parsed);
  const normalised = legacy || undoStack.length !== rawUndo.length || filled;
  // A cleared or deadlocked board has a frozen clock: saves from before the
  // engine banked time on completion can still carry a running startedAt,
  // which would make the win card's time grow, so clockOnLoad drops it.
  const loaded = parsed as MahjongState;
  const state = clockOnLoad(loaded, loaded.isComplete || loaded.isDeadlocked);
  // A save that had to be normalised (a version 1 history, dropped entries,
  // missing fields) is written back once, now: the screen treats a loaded
  // game as saved, and the shim that read it goes away next release.
  if (normalised) await saveGame(state);
  return state;
}

export const {
  save: saveGame,
  load: loadGame,
  clear: clearGame,
} = createJsonSlot<MahjongState, ParsedSave>({
  key: "mahjong_game",
  subsystem: SUBSYSTEM,
  isValid: isSavedGame,
  onLoad: restore,
  beforeSave: (state) => clockForSave(withoutEvents(state)),
});

export const { load: loadStats, save: saveStats } = createRecord<MahjongStats>({
  key: "mahjong_stats_v1",
  subsystem: SUBSYSTEM,
  ops: { load: "loadStats", save: "saveStats" },
  fallback: () => ({ bestTimeMsByLayout: {} }),
  read: (raw) => {
    const parsed = JSON.parse(raw);
    return {
      // Per layout (#2747); a best under the ranking floor is a broken clock
      // and is dropped, and the old cross-layout `bestTimeMs` is ignored.
      bestTimeMsByLayout: loadBestTimes(parsed.bestTimeMsByLayout),
    };
  },
  write: (stats) => JSON.stringify(stats),
});

// ---------------------------------------------------------------------------
// Progress — unlock state for the layout select screen (#1689)
// ---------------------------------------------------------------------------

export interface MahjongProgress {
  readonly unlockedLayouts: string[];
  readonly currentLayoutId: string | null;
  /** Always null — in-progress state is managed by saveGame/loadGame, not here. */
  readonly currentState: MahjongState | null;
}

export const DEFAULT_PROGRESS: MahjongProgress = {
  unlockedLayouts: ["turtle"],
  currentLayoutId: null,
  currentState: null,
};

export const { save: saveProgress, load: loadProgress } = createRecord<MahjongProgress>({
  key: "@mahjong/progress",
  subsystem: SUBSYSTEM,
  ops: { load: "loadProgress", save: "saveProgress" },
  fallback: () => ({ ...DEFAULT_PROGRESS }),
  read: (raw) => {
    const parsed = JSON.parse(raw);
    return {
      unlockedLayouts: Array.isArray(parsed.unlockedLayouts) ? parsed.unlockedLayouts : ["turtle"],
      currentLayoutId: typeof parsed.currentLayoutId === "string" ? parsed.currentLayoutId : null,
      currentState: parsed.currentState ?? null,
    };
  },
  write: (data) => JSON.stringify(data),
});

/**
 * Return the updated unlockedLayouts array after completing `completedId`.
 * Unlocks the next layout in registry order; no-ops if already at the last or
 * the next is already unlocked. Mirrors SortScreen unlock logic (issue #1689).
 */
export function unlockNextLayout(
  completedId: string,
  layouts: readonly LayoutMeta[],
  unlockedLayouts: readonly string[]
): string[] {
  const idx = layouts.findIndex((l) => l.id === completedId);
  if (idx === -1 || idx === layouts.length - 1) return [...unlockedLayouts];
  const nextId = layouts[idx + 1]!.id;
  if (unlockedLayouts.includes(nextId)) return [...unlockedLayouts];
  return [...unlockedLayouts, nextId];
}
