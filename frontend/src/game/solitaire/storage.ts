/**
 * AsyncStorage persistence for in-progress Solitaire games (#597).
 *
 * Saves after every state mutation so a crash or backgrounded app doesn't
 * lose progress. One slot per device; no account linkage in V1.
 *
 * `saveGame` strips the nested `undoStack` arrays from each snapshot down
 * to `[]` so the on-disk payload cannot balloon exponentially (a naive
 * serialize would persist every previous state's prior-state chain). The
 * engine already guarantees nested stacks are `[]` at write time — this
 * is defensive belt-and-suspenders.
 *
 * `loadGame` enforces `_v: 1` so future schema bumps reject incompatible
 * payloads rather than crashing the screen. Corrupt payloads are deleted
 * and reported as a warning (not an exception) — the caller recovers by
 * starting a fresh game.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { SolitaireState } from "./types";

const GAME_KEY = "solitaire_game";
const STATS_KEY = "solitaire_stats_v1";

export interface SolitaireStats {
  bestTimeMs: number;
  bestMoves: number;
  gamesPlayed: number;
  gamesWon: number;
}

function stripNestedUndo(state: SolitaireState): SolitaireState {
  return {
    ...state,
    undoStack: state.undoStack.map((snapshot) => ({ ...snapshot, undoStack: [] })),
  };
}

export async function saveGame(state: SolitaireState): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(stripNestedUndo(state)));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "solitaire.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<SolitaireState | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { -readonly [K in keyof SolitaireState]?: SolitaireState[K] };
    if (
      parsed._v !== 1 ||
      (parsed.drawMode !== 1 && parsed.drawMode !== 3) ||
      !Array.isArray(parsed.tableau) ||
      parsed.tableau.length !== 7 ||
      parsed.foundations === null ||
      typeof parsed.foundations !== "object" ||
      !Array.isArray(parsed.stock) ||
      !Array.isArray(parsed.waste) ||
      typeof parsed.score !== "number" ||
      typeof parsed.recycleCount !== "number" ||
      !Array.isArray(parsed.undoStack) ||
      typeof parsed.isComplete !== "boolean"
    ) {
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }
    // Normalize timer fields — absent in saves created before timer tracking was added.
    parsed.startedAt = parsed.startedAt ?? null;
    parsed.accumulatedMs = parsed.accumulatedMs ?? 0;
    return parsed as SolitaireState;
  } catch (e) {
    Sentry.captureMessage("solitaire.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: "solitaire.storage", op: "load" },
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
    Sentry.captureException(e, { tags: { subsystem: "solitaire.storage", op: "clear" } });
  }
}

const EMPTY_STATS: SolitaireStats = { bestTimeMs: 0, bestMoves: 0, gamesPlayed: 0, gamesWon: 0 };

export async function loadStats(): Promise<SolitaireStats> {
  try {
    const raw = await AsyncStorage.getItem(STATS_KEY);
    if (!raw) return { ...EMPTY_STATS };
    const parsed = JSON.parse(raw);
    return {
      bestTimeMs: typeof parsed.bestTimeMs === "number" ? parsed.bestTimeMs : 0,
      bestMoves: typeof parsed.bestMoves === "number" ? parsed.bestMoves : 0,
      gamesPlayed: typeof parsed.gamesPlayed === "number" ? parsed.gamesPlayed : 0,
      gamesWon: typeof parsed.gamesWon === "number" ? parsed.gamesWon : 0,
    };
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "solitaire.storage", op: "loadStats" } });
    return { ...EMPTY_STATS };
  }
}

export async function saveStats(stats: SolitaireStats): Promise<void> {
  try {
    await AsyncStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "solitaire.storage", op: "saveStats" } });
  }
}
