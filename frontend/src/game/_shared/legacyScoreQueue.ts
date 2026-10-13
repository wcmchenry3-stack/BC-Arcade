/**
 * What is left of the removed offline score queue (#2644).
 *
 * Older builds queued unsent per-game score submissions, with the player's
 * name, under this AsyncStorage key. The routes those items were for are gone
 * and nothing reads the key any more, so it is only ever cleared: once at
 * launch (`NetworkProvider`) and by "Delete my data".
 *
 * The same clear also removes two more orphaned device keys (#3140):
 * `twenty48_stats_v1` (the 2048 counters, no longer read or written since
 * #2636) and `hearts_pending_submission` (the pre-#2629 owed Hearts score).
 *
 * Removal: delete this module (and its two call sites) after 2027-04-07, by
 * which time every install that could still hold the key has launched a build
 * that clears it (decision recorded in #2970).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const LEGACY_SCORE_QUEUE_KEY = "pending_score_queue_v1";

/** Device keys nothing reads or writes any more (#3140). */
export const ORPHANED_DEVICE_KEYS = ["twenty48_stats_v1", "hearts_pending_submission"] as const;

/**
 * Remove the old queue's items and the orphaned device keys, if any.
 * Idempotent; never rejects.
 */
export async function clearLegacyScoreQueue(): Promise<void> {
  for (const key of [LEGACY_SCORE_QUEUE_KEY, ...ORPHANED_DEVICE_KEYS]) {
    try {
      await AsyncStorage.removeItem(key);
    } catch {
      // Nothing reads the key: a failed removal is retried at the next launch.
    }
  }
}
