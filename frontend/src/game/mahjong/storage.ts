/**
 * AsyncStorage persistence for in-progress Mahjong games (#872).
 *
 * Saves after every state mutation. One slot per device; no account linkage in V1.
 *
 * `saveGame` strips nested `undoStack` arrays down to `[]` so the on-disk
 * payload cannot balloon (the engine guarantees nested stacks are already `[]`,
 * this is defensive belt-and-suspenders).
 *
 * `loadGame` enforces `_v: 1` so future schema bumps reject incompatible
 * payloads rather than crashing. Corrupt payloads are deleted and reported
 * as a warning — the caller recovers by starting a fresh game.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { LayoutMeta, MahjongState } from "./types";
import { resolveLayoutId } from "./layouts/registry";

const GAME_KEY = "mahjong_game";
const STATS_KEY = "mahjong_stats_v1";

export interface MahjongStats {
  bestScore: number;
  bestTimeMs: number;
  gamesPlayed: number;
  gamesWon: number;
}

function stripNestedUndo(state: MahjongState): MahjongState {
  return {
    ...state,
    undoStack: state.undoStack.map((snapshot) => ({ ...snapshot, undoStack: [] })),
  };
}

export async function saveGame(state: MahjongState): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(stripNestedUndo(state)));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "mahjong.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<MahjongState | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MahjongState>;
    if (
      parsed._v !== 1 ||
      !Array.isArray(parsed.tiles) ||
      typeof parsed.pairsRemoved !== "number" ||
      typeof parsed.score !== "number" ||
      typeof parsed.shufflesLeft !== "number" ||
      !Array.isArray(parsed.undoStack) ||
      typeof parsed.isComplete !== "boolean" ||
      typeof parsed.isDeadlocked !== "boolean" ||
      typeof parsed.accumulatedMs !== "number"
    ) {
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }
    parsed.startedAt = parsed.startedAt ?? null;
    // dealId added in #943 — fall back gracefully for saves from older builds
    if (typeof parsed.dealId !== "string") parsed.dealId = "0000";
    // currentLayoutId added in #1688 — resolveLayoutId() defaults to "turtle" for old saves
    parsed.currentLayoutId = resolveLayoutId(parsed as { currentLayoutId?: string });
    return parsed as MahjongState;
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

const EMPTY_STATS: MahjongStats = { bestScore: 0, bestTimeMs: 0, gamesPlayed: 0, gamesWon: 0 };

export async function loadStats(): Promise<MahjongStats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    const parsed = JSON.parse(raw);
    return {
      bestScore: typeof parsed.bestScore === "number" ? parsed.bestScore : 0,
      bestTimeMs: typeof parsed.bestTimeMs === "number" ? parsed.bestTimeMs : 0,
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
