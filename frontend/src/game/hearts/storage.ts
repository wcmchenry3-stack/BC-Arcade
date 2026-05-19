import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import type { AiPreset, HeartsState } from "./types";
import { AI_PRESETS } from "./types";

const GAME_KEY = "hearts_game";
const LEGACY_PERSONA_MAP: Record<string, string> = {
  easy: "cautious",
  medium: "schemer",
  hard: "daring",
};

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
      parsed["aiDifficulty"] = "schemer";
    } else if (rawV !== 3) {
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }

    // Migrate pre-#1653 persona values ("easy"→"cautious", etc.)
    const storedPersona = parsed["aiDifficulty"];
    if (typeof storedPersona === "string" && storedPersona in LEGACY_PERSONA_MAP) {
      parsed["aiDifficulty"] = LEGACY_PERSONA_MAP[storedPersona];
    }

    const p = parsed as Partial<HeartsState>;
    if (
      p._v !== 3 ||
      !(AI_PRESETS as readonly string[]).includes(p.aiDifficulty as string) ||
      !Array.isArray(p.playerHands) ||
      p.playerHands.length !== 4 ||
      !Array.isArray(p.cumulativeScores) ||
      p.cumulativeScores.length !== 4 ||
      !Array.isArray(p.handScores) ||
      p.handScores.length !== 4 ||
      !p.handScores.every((v) => typeof v === "number" && v >= 0 && v <= 26) ||
      !Array.isArray(p.scoreHistory) ||
      !p.scoreHistory.every(
        (row) =>
          Array.isArray(row) &&
          row.length === 4 &&
          row.every((v) => typeof v === "number" && v >= 0 && v <= 26)
      ) ||
      !Array.isArray(p.currentTrick) ||
      !Array.isArray(p.wonCards) ||
      typeof p.tricksPlayedInHand !== "number" ||
      typeof p.heartsBroken !== "boolean" ||
      typeof p.isComplete !== "boolean"
    ) {
      Sentry.captureMessage("hearts.storage: invalid game state, discarding", {
        level: "warning",
        tags: { subsystem: "hearts.storage", op: "load" },
        extra: {
          _v: p._v,
          handScores: p.handScores,
          scoreHistoryLength: Array.isArray(p.scoreHistory) ? p.scoreHistory.length : null,
        },
      });
      await AsyncStorage.removeItem(GAME_KEY).catch(() => {});
      return null;
    }
    return { ...p, aiDifficulty: p.aiDifficulty as AiPreset } as HeartsState;
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
