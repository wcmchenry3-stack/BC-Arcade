/**
 * AsyncStorage persistence for Yacht in-progress games.
 *
 * Saves after every action (roll/score/new game) so a crash or app-kill
 * mid-game doesn't lose progress. One slot per device.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { GameState } from "./types";
import type { AiDifficulty } from "./types";

const STORAGE_KEY = "yacht_game_v2";

export interface SavedGame {
  state: GameState;
  aiDifficulty: AiDifficulty | null;
  aiState: GameState | null;
}

export async function saveGame(
  state: GameState,
  aiDifficulty: AiDifficulty | null = null,
  aiState: GameState | null = null
): Promise<void> {
  const payload: SavedGame = { state, aiDifficulty, aiState };
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "yacht.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<SavedGame | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SavedGame;
    // Sanity check — shape drift should discard rather than crash the screen.
    if (
      !parsed.state ||
      !Array.isArray(parsed.state.dice) ||
      parsed.state.dice.length !== 5 ||
      typeof parsed.state.round !== "number" ||
      typeof parsed.state.scores !== "object" ||
      parsed.state.scores === null
    ) {
      return null;
    }
    return parsed;
  } catch (e) {
    // Corrupt payload: recovery is complete. See #501/#510 for the
    // rationale behind downgrading this from captureException to a
    // warning-level captureMessage.
    Sentry.captureMessage("yacht.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: "yacht.storage", op: "load" },
      extra: { error: String(e), key: STORAGE_KEY },
    });
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    return null;
  }
}

export async function clearGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "yacht.storage", op: "clear" } });
  }
}
