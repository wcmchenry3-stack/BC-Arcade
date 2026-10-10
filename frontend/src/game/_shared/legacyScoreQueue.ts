/**
 * What is left of the removed offline score queue (#2644).
 *
 * Older builds queued unsent per-game score submissions, with the player's
 * name, under this AsyncStorage key. The routes those items were for are gone
 * and nothing reads the key any more, so it is only ever cleared: once at
 * launch (`NetworkProvider`) and by "Delete my data".
 *
 * Removal: delete this module (and its two call sites) after 2027-04-07, by
 * which time every install that could still hold the key has launched a build
 * that clears it (decision recorded in #2970).
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

export const LEGACY_SCORE_QUEUE_KEY = "pending_score_queue_v1";

/** Remove the old queue's items, if any. Never rejects. */
export async function clearLegacyScoreQueue(): Promise<void> {
  try {
    await AsyncStorage.removeItem(LEGACY_SCORE_QUEUE_KEY);
  } catch {
    // Nothing reads the key: a failed removal is retried at the next launch.
  }
}
