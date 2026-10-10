/**
 * AsyncStorage persistence for Yacht in-progress games.
 *
 * Saves after every action (roll/score/new game) so a crash or app-kill
 * mid-game doesn't lose progress. One slot per device, through the shared
 * `storageSlot` (#2987); a payload that fails the shape check loads as no
 * game and is left stored.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { AI_DIFFICULTIES, GameState } from "./types";
import type { AiDifficulty } from "./types";
import { isPremiumLevel } from "../../entitlements/premiumLevels";
import { createJsonSlot } from "../_shared/storageSlot";

const PREF_KEY = "yacht_pref_v1";

export interface SavedGame {
  state: GameState;
  aiDifficulty: AiDifficulty | null;
  aiState: GameState | null;
  /**
   * The session id of the player's finished game (#2630), saved once their
   * game ends. A game reopened while the computer still has its last turn to
   * play (or whose card was showing) looks its rank up with it. Kept in the
   * same payload as the state, so the two can never disagree, and cleared
   * with it.
   */
  finishedGameId?: string;
}

const gameSlot = createJsonSlot<SavedGame>({
  key: "yacht_game_v2",
  subsystem: "yacht.storage",
  // Sanity check — shape drift should discard rather than crash the screen.
  isValid: (p): p is SavedGame => {
    const parsed = p as SavedGame;
    return !(
      !parsed.state ||
      !Array.isArray(parsed.state.dice) ||
      parsed.state.dice.length !== 5 ||
      typeof parsed.state.round !== "number" ||
      typeof parsed.state.scores !== "object" ||
      parsed.state.scores === null
    );
  },
  keepInvalid: true,
  onLoad: (parsed) => {
    // A bad finished-game id only costs the card its rank, not the game.
    const { finishedGameId } = parsed;
    if (
      finishedGameId !== undefined &&
      !(typeof finishedGameId === "string" && finishedGameId.length > 0)
    ) {
      delete parsed.finishedGameId;
    }
    return parsed;
  },
});

export function saveGame(
  state: GameState,
  aiDifficulty: AiDifficulty | null = null,
  aiState: GameState | null = null,
  finishedGameId: string | null = null
): Promise<void> {
  const payload: SavedGame = { state, aiDifficulty, aiState };
  if (finishedGameId) payload.finishedGameId = finishedGameId;
  return gameSlot.save(payload);
}

export const { load: loadGame, clear: clearGame } = gameSlot;

export interface LastModePref {
  mode: "solo" | "vs";
  difficulty: AiDifficulty;
}

export async function saveLastMode(mode: "solo" | "vs", difficulty: AiDifficulty): Promise<void> {
  try {
    await AsyncStorage.setItem(PREF_KEY, JSON.stringify({ mode, difficulty }));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "yacht.storage", op: "saveLastMode" } });
  }
}

export async function loadLastMode(): Promise<LastModePref | null> {
  try {
    const raw = await AsyncStorage.getItem(PREF_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LastModePref>;
    // An unknown or now-premium difficulty falls back to the default (#1129).
    const difficulty =
      AI_DIFFICULTIES.find((d) => d === parsed.difficulty && !isPremiumLevel("yacht", d)) ??
      "medium";
    return { mode: parsed.mode === "vs" ? "vs" : "solo", difficulty };
  } catch (e) {
    Sentry.addBreadcrumb({
      category: "yacht.storage",
      message: "loadLastMode: failed to read pref, using defaults",
      level: "warning",
      data: { error: String(e) },
    });
    return null;
  }
}
