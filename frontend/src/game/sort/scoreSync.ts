/**
 * Sort's handler for flushing queued score submissions.
 *
 * Registered once at module load by NetworkContext. Keeps queue-flush
 * logic co-located with Sort rather than in a central switch.
 */

import { sortApi } from "./api";
import { scoreQueue } from "../_shared/scoreQueue";
import type { PendingSubmission } from "../_shared/types";

export function registerSortScoreHandler(): void {
  scoreQueue.registerHandler("sort", async (item: PendingSubmission) => {
    const { player_name, level_reached } = item.payload as {
      player_name: string;
      level_reached: number;
    };
    if (typeof player_name !== "string" || typeof level_reached !== "number") {
      // Malformed payload — drop by "succeeding" (throwing would retry forever).
      return;
    }
    await sortApi.submitScore(player_name, level_reached);
  });
}
