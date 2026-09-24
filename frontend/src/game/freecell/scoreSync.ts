/**
 * FreeCell's handler for flushing queued score submissions.
 *
 * Registered once at module load by NetworkContext. Keeps queue-flush
 * logic co-located with FreeCell rather than in a central switch.
 */

import { freecellApi } from "./api";
import { scoreQueue } from "../_shared/scoreQueue";
import type { PendingSubmission } from "../_shared/types";

export function registerFreeCellScoreHandler(): void {
  scoreQueue.registerHandler("freecell", async (item: PendingSubmission) => {
    const { player_id, move_count } = item.payload as { player_id: string; move_count: number };
    if (typeof player_id !== "string" || typeof move_count !== "number") {
      // Malformed payload — drop by "succeeding" (throwing would retry forever).
      return;
    }
    await freecellApi.submitScore(player_id, move_count);
  });
}
