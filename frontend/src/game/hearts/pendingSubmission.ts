/**
 * The Hearts leaderboard score still owed for the finished game (#2506).
 *
 * Hearts keeps its game-over state saved, so the result card comes back when
 * the app is reopened. A game that ended here records its score as pending;
 * it's cleared once the submission is saved or queued. On reopening, only a
 * still-pending score is sent — so a submission interrupted by closing the
 * app (e.g. while the card asked for a display name) resumes, and one that
 * already went out is never sent twice.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "hearts_pending_submission";

export interface PendingHeartsSubmission {
  readonly score: number;
}

export async function savePendingSubmission(pending: PendingHeartsSubmission): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, JSON.stringify(pending));
  } catch {
    // Best-effort: at worst an interrupted submission isn't resumed.
  }
}

export async function loadPendingSubmission(): Promise<PendingHeartsSubmission | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { score?: unknown };
    return typeof parsed.score === "number" ? { score: parsed.score } : null;
  } catch {
    return null;
  }
}

export async function clearPendingSubmission(): Promise<void> {
  try {
    await AsyncStorage.removeItem(KEY);
  } catch {
    // Best-effort.
  }
}
