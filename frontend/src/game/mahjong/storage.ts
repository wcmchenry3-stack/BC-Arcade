/**
 * AsyncStorage persistence for in-progress Mahjong games (#872).
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
 * through the `legacyUndo` shim for one release; any other version is
 * rejected rather than crashing. Corrupt payloads are deleted and reported
 * as a warning — the caller recovers by starting a fresh game. An undo
 * history that doesn't check out only costs the entries from the bad one
 * back (`loadUndoEntries`); the game itself loads.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { LayoutMeta, MahjongState } from "./types";
import { resolveLayoutId } from "./layouts/registry";
import { clockForSave, clockOnLoad } from "../_shared/playClock";
import { plausibleBestMs } from "./engine";
import { migrateLegacyUndoStack } from "./legacyUndo";
import { loadUndoEntries } from "./undoEntries";

const GAME_KEY = "mahjong_game";
const STATS_KEY = "mahjong_stats_v1";

export interface MahjongStats {
  bestScore: number;
  /**
   * The fastest clear on this device, per layout id (#2747): each layout has
   * its own board, so a fast clear on an easy layout is no best on a hard
   * one. Only clears at or above MAHJONG_MIN_CLEAR_MS count. Saves from
   * before #2747 kept one `bestTimeMs` across every layout; it can't be
   * attributed to a layout, so it is dropped on load (it would otherwise
   * show as a false best on some layout).
   */
  bestTimeMsByLayout: Readonly<Record<string, number>>;
  gamesPlayed: number;
  gamesWon: number;
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

export async function saveGame(state: MahjongState): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(clockForSave(state)));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "mahjong.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<MahjongState | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as {
      -readonly [K in keyof MahjongState]?: K extends "_v" | "undoStack"
        ? unknown
        : MahjongState[K];
    };
    const legacy = parsed._v === 1;
    if (
      (parsed._v !== 2 && !legacy) ||
      !Array.isArray(parsed.tiles) ||
      typeof parsed.pairsRemoved !== "number" ||
      typeof parsed.score !== "number" ||
      typeof parsed.shufflesLeft !== "number" ||
      !Array.isArray(parsed.undoStack) ||
      typeof parsed.isComplete !== "boolean" ||
      typeof parsed.isDeadlocked !== "boolean"
    ) {
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }
    // Undo deltas since #2961; a version 1 save's snapshots are converted.
    parsed.undoStack = legacy
      ? migrateLegacyUndoStack(parsed.undoStack, parsed.tiles)
      : loadUndoEntries(parsed.undoStack, parsed.tiles);
    parsed._v = 2;
    // Timer fields: a save without them loads with no play banked (#2750).
    parsed.startedAt = parsed.startedAt ?? null;
    if (typeof parsed.accumulatedMs !== "number") parsed.accumulatedMs = 0;
    // dealId added in #943 — fall back gracefully for saves from older builds
    if (typeof parsed.dealId !== "string") parsed.dealId = "0000";
    // currentLayoutId added in #1688 — resolveLayoutId() defaults to "turtle" for old saves
    parsed.currentLayoutId = resolveLayoutId(parsed as { currentLayoutId?: string });
    // A cleared or deadlocked board has a frozen clock: saves from before the
    // engine banked time on completion can still carry a running startedAt,
    // which would make the win card's time grow, so clockOnLoad drops it.
    const loaded = parsed as MahjongState;
    return clockOnLoad(loaded, loaded.isComplete || loaded.isDeadlocked);
  } catch (e) {
    Sentry.captureMessage("mahjong.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: "mahjong.storage", op: "load" },
      extra: { error: String(e), key: GAME_KEY },
    });
    await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
    return null;
  }
}

export async function clearGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(GAME_KEY);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "mahjong.storage", op: "clear" } });
  }
}

const EMPTY_STATS: MahjongStats = {
  bestScore: 0,
  bestTimeMsByLayout: {},
  gamesPlayed: 0,
  gamesWon: 0,
};

export async function loadStats(): Promise<MahjongStats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    const parsed = JSON.parse(raw);
    return {
      bestScore: typeof parsed.bestScore === "number" ? parsed.bestScore : 0,
      // Per layout (#2747); a best under the ranking floor is a broken clock
      // and is dropped, and the old cross-layout `bestTimeMs` is ignored.
      bestTimeMsByLayout: loadBestTimes(parsed.bestTimeMsByLayout),
      gamesPlayed: typeof parsed.gamesPlayed === "number" ? parsed.gamesPlayed : 0,
      gamesWon: typeof parsed.gamesWon === "number" ? parsed.gamesWon : 0,
    };
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "mahjong.storage", op: "loadStats" } });
    return { ...EMPTY_STATS };
  }
}

export async function saveStats(stats: MahjongStats): Promise<void> {
  try {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "mahjong.storage", op: "saveStats" } });
  }
}

// ---------------------------------------------------------------------------
// Progress — unlock state for the layout select screen (#1689)
// ---------------------------------------------------------------------------

const PROGRESS_KEY = "@mahjong/progress";

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

export async function saveProgress(data: MahjongProgress): Promise<void> {
  try {
    await AsyncStorage.setItem(PROGRESS_KEY, JSON.stringify(data));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "mahjong.storage", op: "saveProgress" } });
  }
}

export async function loadProgress(): Promise<MahjongProgress> {
  try {
    const raw = await AsyncStorage.getItem(PROGRESS_KEY);
    if (!raw) return { ...DEFAULT_PROGRESS };
    const parsed = JSON.parse(raw);
    return {
      unlockedLayouts: Array.isArray(parsed.unlockedLayouts) ? parsed.unlockedLayouts : ["turtle"],
      currentLayoutId: typeof parsed.currentLayoutId === "string" ? parsed.currentLayoutId : null,
      currentState: parsed.currentState ?? null,
    };
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "mahjong.storage", op: "loadProgress" } });
    return { ...DEFAULT_PROGRESS };
  }
}

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
