import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { AiDifficulty, HeartsState } from "./types";

const GAME_KEY = "hearts_game";
const AI_DIFFICULTY_VALUES: readonly string[] = ["easy", "medium", "hard"];

export async function saveGame(state: HeartsState): Promise<void> {
  try {
    await AsyncStorage.setItem(GAME_KEY, JSON.stringify(state));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "hearts.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<HeartsState | null> {
  try {
    const raw = await AsyncStorage.getItem(GAME_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const rawV = parsed["_v"];

    // v2 → v3 migration: add aiDifficulty default
    if (rawV === 2) {
      parsed["_v"] = 3;
      parsed["aiDifficulty"] = "medium";
    } else if (rawV !== 3) {
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }

    const p = parsed as Partial<HeartsState>;
    if (
      p._v !== 3 ||
      !AI_DIFFICULTY_VALUES.includes(p.aiDifficulty as string) ||
      !Array.isArray(p.playerHands) ||
      p.playerHands.length !== 4 ||
      !Array.isArray(p.cumulativeScores) ||
      p.cumulativeScores.length !== 4 ||
      !Array.isArray(p.handScores) ||
      p.handScores.length !== 4 ||
      !Array.isArray(p.scoreHistory) ||
      !p.scoreHistory.every(
        (row) => Array.isArray(row) && row.length === 4 && row.every((v) => typeof v === "number")
      ) ||
      !Array.isArray(p.currentTrick) ||
      !Array.isArray(p.wonCards) ||
      typeof p.tricksPlayedInHand !== "number" ||
      typeof p.heartsBroken !== "boolean" ||
      typeof p.isComplete !== "boolean"
    ) {
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }
    return { ...p, aiDifficulty: p.aiDifficulty as AiDifficulty } as HeartsState;
  } catch (e) {
    Sentry.captureMessage("hearts.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: "hearts.storage", op: "load" },
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
    Sentry.captureException(e, { tags: { subsystem: "hearts.storage", op: "clear" } });
  }
}
