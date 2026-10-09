import AsyncStorage from "@react-native-async-storage/async-storage";
import { createJsonSlot } from "../_shared/storageSlot";
import type { AiPreset, HeartsState, SavedHeartsState } from "./types";
import { AI_PRESETS } from "./types";

const GAME_KEY = "hearts_game";
/**
 * The session id of the finished game whose result card is showing (#2629):
 * a finished game is kept saved, so its card comes back when the app is
 * reopened, and asks for the game's rank again with this id.
 */
const FINISHED_GAME_ID_KEY = "hearts_finished_game_id";
/** Pre-#2629 builds' owed leaderboard score; nothing reads it any more. */
const LEGACY_PENDING_SUBMISSION_KEY = "hearts_pending_submission";
const LEGACY_PERSONA_MAP: Record<string, string> = {
  easy: "cautious",
  medium: "schemer",
  hard: "daring",
};

type ParsedSave = Partial<HeartsState> & { accumulatedMs?: unknown };

/** v2 → v3 (adds `aiDifficulty`), and pre-#1653 persona names; in place. */
function migrate(p: unknown): unknown {
  const parsed = p as Record<string, unknown>;
  // v2 → v3 migration: add aiDifficulty default
  if (parsed["_v"] === 2) {
    parsed["_v"] = 3;
    parsed["aiDifficulty"] = "schemer";
  }
  // Migrate pre-#1653 persona values ("easy"→"cautious", etc.)
  const storedPersona = parsed["aiDifficulty"];
  if (typeof storedPersona === "string" && storedPersona in LEGACY_PERSONA_MAP) {
    parsed["aiDifficulty"] = LEGACY_PERSONA_MAP[storedPersona];
  }
  return parsed;
}

function isSavedGame(parsed: unknown): parsed is ParsedSave {
  const p = parsed as ParsedSave;
  return !(
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
  );
}

/**
 * `saveGame` saves the game with its play time (`withPlayTime` in ./clock
 * builds it). `loadGame` resolves the saved game, or null; its
 * `accumulatedMs` is always a usable play time: 0 when an older save has
 * none or the stored value is bad. `clearGame` forgets the saved game and
 * its finished-game id (new game).
 */
export const {
  save: saveGame,
  load: loadGame,
  clear: clearGame,
} = createJsonSlot<SavedHeartsState, ParsedSave>({
  key: GAME_KEY,
  subsystem: "hearts.storage",
  migrate,
  isValid: isSavedGame,
  // An unknown version is dropped silently; a v3 save that fails the check is reported.
  invalidWarning: (parsed) => {
    const p = parsed as ParsedSave;
    if (p._v !== 3) return null;
    return {
      message: "hearts.storage: invalid game state, discarding",
      extra: {
        _v: p._v,
        handScores: p.handScores,
        scoreHistoryLength: Array.isArray(p.scoreHistory) ? p.scoreHistory.length : null,
      },
    };
  },
  onLoad: (p) => {
    // Play time (#2629): absent in older saves, and a bad value counts as none.
    const ms = p.accumulatedMs;
    const accumulatedMs = typeof ms === "number" && Number.isFinite(ms) && ms > 0 ? ms : 0;
    return { ...p, aiDifficulty: p.aiDifficulty as AiPreset, accumulatedMs } as SavedHeartsState;
  },
  clearAlso: [FINISHED_GAME_ID_KEY, LEGACY_PENDING_SUBMISSION_KEY],
});

export async function saveFinishedGameId(gameId: string): Promise<void> {
  try {
    await AsyncStorage.setItem(FINISHED_GAME_ID_KEY, gameId);
  } catch {
    // Best-effort: at worst a reopened card shows no rank.
  }
}

export async function loadFinishedGameId(): Promise<string | null> {
  try {
    const id = await AsyncStorage.getItem(FINISHED_GAME_ID_KEY);
    return id ? id : null;
  } catch {
    return null;
  }
}
