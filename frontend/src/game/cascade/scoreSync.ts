/**
 * Cascade's handler for flushing queued score submissions.
 *
 * Registered once at module load by NetworkContext. Keeps queue-flush
 * logic co-located with Cascade rather than in a central switch.
 */

import { cascadeApi } from "./api";
import { scoreQueue } from "../_shared/scoreQueue";
import { flushQueuedGames } from "../_shared/flushQueuedGames";
import { PendingSubmission } from "../_shared/types";

export function registerCascadeScoreHandler(): void {
  scoreQueue.registerHandler("cascade", async (item: PendingSubmission) => {
    const { game_id, player_name } = item.payload as { game_id: string; player_name: string };
    if (typeof game_id !== "string" || typeof player_name !== "string") {
      // Malformed payload — drop by "succeeding" (throwing would keep retrying forever).
      return;
    }
    // On reconnect NetworkContext flushes this queue and SyncWorker together;
    // make sure the game itself has been uploaded before naming it.
    await flushQueuedGames();
    await cascadeApi.submitPlayerName(game_id, player_name);
  });
}
