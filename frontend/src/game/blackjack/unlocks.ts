import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { RunRecord } from "./storage";

/** A comeback: at most a quarter of the starting chips left, before the goal. */
const COMEBACK_FRACTION = 0.25;

/**
 * The chip low a comeback is judged on: the low before the goal was reached
 * (#2628), or `lowestChips` for runs saved by older builds.
 */
export function comebackLow(r: RunRecord): number {
  return r.lowestChipsBeforeGoal ?? r.lowestChips;
}

/**
 * True when the run reached its goal after falling to at most a quarter of its
 * starting chips. The one rule for the comeback unlock, the run-history badge
 * and the biggest comeback (#2628); a bust after Keep Playing does not count.
 */
export function isComebackRun(r: RunRecord): boolean {
  return r.completed && comebackLow(r) <= r.startingChips * COMEBACK_FRACTION;
}

const UNLOCKS_KEY = "blackjack_unlocks_v1";

export interface Unlock {
  id: string;
  name: string;
  type: "table_theme" | "card_back" | "chip_style";
  conditionType: "complete_table" | "run_count" | "comeback";
  conditionValue: string | number | null;
  unlocked: boolean;
  unlockedAt?: string;
}

export const INITIAL_UNLOCKS: readonly Unlock[] = [
  {
    id: "beginner_table_theme",
    name: "Felt Classic",
    type: "table_theme",
    conditionType: "complete_table",
    conditionValue: "beginner",
    unlocked: false,
  },
  {
    id: "intermediate_card_back",
    name: "Indigo Card Back",
    type: "card_back",
    conditionType: "complete_table",
    conditionValue: "intermediate",
    unlocked: false,
  },
  {
    id: "high_roller_chip_style",
    name: "Gold Chip Set",
    type: "chip_style",
    conditionType: "complete_table",
    conditionValue: "high_roller",
    unlocked: false,
  },
];

/**
 * Pure function. Given a run history and the current unlock state, returns
 * only the unlocks newly triggered by those runs. Caller is responsible for
 * merging the result back into the full unlock list before persisting.
 */
export function evaluateUnlocks(runHistory: RunRecord[], existingUnlocks: Unlock[]): Unlock[] {
  const now = new Date().toISOString();
  const newlyUnlocked: Unlock[] = [];

  for (const unlock of existingUnlocks) {
    if (unlock.unlocked) continue;

    let triggered = false;

    if (unlock.conditionType === "complete_table") {
      triggered = runHistory.some((r) => r.table === unlock.conditionValue && r.completed);
    } else if (unlock.conditionType === "run_count") {
      triggered = runHistory.length >= Number(unlock.conditionValue);
    } else if (unlock.conditionType === "comeback") {
      triggered = runHistory.some(isComebackRun);
    }

    if (triggered) {
      newlyUnlocked.push({ ...unlock, unlocked: true, unlockedAt: now });
    }
  }

  return newlyUnlocked;
}

export async function loadUnlocks(): Promise<Unlock[]> {
  try {
    const raw = await AsyncStorage.getItem(UNLOCKS_KEY);
    if (!raw) return INITIAL_UNLOCKS.map((u) => ({ ...u }));
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      Sentry.captureMessage("blackjack.unlocks: stored value is not an array, resetting", {
        level: "warning",
        tags: { subsystem: "blackjack.unlocks", op: "loadUnlocks" },
      });
      await AsyncStorage.removeItem(UNLOCKS_KEY).catch(() => {});
      return INITIAL_UNLOCKS.map((u) => ({ ...u }));
    }
    return parsed as Unlock[];
  } catch (e) {
    Sentry.captureMessage("blackjack.unlocks: corrupt payload, resetting", {
      level: "warning",
      tags: { subsystem: "blackjack.unlocks", op: "loadUnlocks" },
      extra: { error: String(e) },
    });
    await AsyncStorage.removeItem(UNLOCKS_KEY).catch(() => {});
    return INITIAL_UNLOCKS.map((u) => ({ ...u }));
  }
}

export async function saveUnlocks(unlocks: Unlock[]): Promise<void> {
  try {
    await AsyncStorage.setItem(UNLOCKS_KEY, JSON.stringify(unlocks));
  } catch (e) {
    Sentry.captureException(e, { tags: { subsystem: "blackjack.unlocks", op: "saveUnlocks" } });
  }
}

/**
 * Merge newly triggered unlocks into a full unlock list, preserving order.
 * Returns a new array with the triggered items replaced by their unlocked versions.
 */
export function mergeUnlocks(existing: Unlock[], triggered: Unlock[]): Unlock[] {
  if (triggered.length === 0) return existing;
  const triggeredById = new Map(triggered.map((u) => [u.id, u]));
  return existing.map((u) => triggeredById.get(u.id) ?? u);
}
