/**
 * AsyncStorage persistence for Blackjack in-progress games and run history.
 *
 * Persists the full engine state (deck + both hands + chip balance) so a
 * player can close the app mid-hand and resume where they left off, and
 * so chip balance carries across launches.
 *
 * Run history is stored separately under RUNS_KEY and capped at MAX_RUNS.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { DEFAULT_RULES, DEFAULT_RUN_CONFIG, EngineState } from "./engine";

const STORAGE_KEY = "blackjack_game_v2";
const RUNS_KEY = "blackjack_runs_v1";
const MAX_RUNS = 50;

export interface RunRecord {
  /** Table tier the run was played on. BJ-2 will populate tiers; defaults to "beginner". */
  table: string;
  startingChips: number;
  finalChips: number;
  runGoal: number | null;
  /** True when the run ended in victory (chips >= runGoal). */
  completed: boolean;
  handsPlayed: number;
  biggestWin: number;
  lowestChips: number;
  /** Unix ms timestamp when the session started. */
  startedAt: number;
  /** Unix ms timestamp when the session ended. */
  endedAt: number;
}

export async function saveRun(record: RunRecord): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(RUNS_KEY);
    const existing: RunRecord[] = raw ? (JSON.parse(raw) as RunRecord[]) : [];
    const updated = [...existing, record];
    // Drop oldest entries when over the cap.
    const trimmed = updated.length > MAX_RUNS ? updated.slice(updated.length - MAX_RUNS) : updated;
    await AsyncStorage.setItem(RUNS_KEY, JSON.stringify(trimmed));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "blackjack.storage", op: "saveRun" } });
  }
}

export async function loadRuns(): Promise<RunRecord[]> {
  try {
    const raw = await AsyncStorage.getItem(RUNS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      Sentry.captureMessage("blackjack.storage: runs payload is not an array, discarding", {
        level: "warning",
        tags: { subsystem: "blackjack.storage", op: "loadRuns" },
      });
      await AsyncStorage.removeItem(RUNS_KEY).catch(() => {});
      return [];
    }
    return parsed as RunRecord[];
  } catch (e) {
    Sentry.captureMessage("blackjack.storage: corrupt runs payload, discarding", {
      level: "warning",
      tags: { subsystem: "blackjack.storage", op: "loadRuns" },
      extra: { error: String(e) },
    });
    await AsyncStorage.removeItem(RUNS_KEY).catch(() => {});
    return [];
  }
}

export async function saveGame(state: EngineState): Promise<void> {
  try {
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "blackjack.storage", op: "save" } });
  }
}

export async function loadGame(): Promise<EngineState | null> {
  let raw: string | null = null;
  try {
    raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EngineState;
    // Minimum viability check — only discard if the core fields are missing.
    if (
      typeof parsed.chips !== "number" ||
      typeof parsed.bet !== "number" ||
      typeof parsed.phase !== "string" ||
      !Array.isArray(parsed.deck) ||
      !Array.isArray(parsed.player_hand) ||
      !Array.isArray(parsed.dealer_hand)
    ) {
      return null;
    }
    // Backfill split-hand arrays for saves created before split was added (#569).
    if (!Array.isArray(parsed.player_hands)) {
      parsed.player_hands = [parsed.player_hand];
    }
    if (!Array.isArray(parsed.hand_bets)) {
      parsed.hand_bets = [parsed.bet];
    }
    if (!Array.isArray(parsed.hand_outcomes)) {
      parsed.hand_outcomes = [parsed.outcome ?? null];
    }
    if (!Array.isArray(parsed.hand_payouts)) {
      parsed.hand_payouts = [parsed.payout ?? 0];
    }
    if (!Array.isArray(parsed.split_from_aces)) {
      parsed.split_from_aces = [false];
    }
    if (typeof parsed.active_hand_index !== "number") {
      parsed.active_hand_index = 0;
    }
    if (typeof parsed.split_count !== "number") {
      parsed.split_count = 0;
    }
    if (typeof parsed.doubled !== "boolean") {
      parsed.doubled = false;
    }
    // Backfill rules for saves created before configurable rules.
    if (!parsed.rules) {
      parsed.rules = DEFAULT_RULES;
    }
    // Backfill lastWin for saves created before the HUD was added.
    if (!("lastWin" in (parsed as object))) {
      (parsed as unknown as Record<string, unknown>).lastWin = null;
    }
    // Backfill run-mode fields for saves created before run mode was added.
    if (typeof parsed.runGoal === "undefined") {
      parsed.runGoal = DEFAULT_RUN_CONFIG.runGoal;
    }
    if (typeof parsed.startingChips !== "number") {
      parsed.startingChips = DEFAULT_RUN_CONFIG.startingChips;
    }
    if (typeof parsed.betMin !== "number") {
      parsed.betMin = DEFAULT_RUN_CONFIG.betMin;
    }
    if (typeof parsed.betMax !== "number") {
      parsed.betMax = DEFAULT_RUN_CONFIG.betMax;
    }
    // Backfill milestone fields for saves created before BJ-5.
    if (!Array.isArray(parsed.milestones)) {
      parsed.milestones = [];
    }
    if (!Array.isArray(parsed.milestones_reached)) {
      parsed.milestones_reached = [];
    }
    return parsed;
  } catch (e) {
    // Corrupt payload: recovery is complete (we remove the bad entry and
    // return null, so the caller starts a fresh game). This is not an
    // error — downgrade from captureException to a warning captureMessage
    // so it doesn't page as a crash in Sentry. See #510.
    Sentry.captureMessage("blackjack.storage: corrupt game payload, discarding", {
      level: "warning",
      tags: { subsystem: "blackjack.storage", op: "load" },
      extra: { error: String(e), key: STORAGE_KEY, rawPayload: raw?.slice(0, 500) },
    });
    await AsyncStorage.removeItem(STORAGE_KEY).catch(() => {});
    return null;
  }
}

export async function clearGame(): Promise<void> {
  try {
    await AsyncStorage.removeItem(STORAGE_KEY);
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "blackjack.storage", op: "clear" } });
  }
}
