/**
 * Sudoku's handler for flushing queued score submissions.
 *
 * Registered once at module load by NetworkContext. Keeps queue-flush
 * logic co-located with Sudoku rather than in a central switch.
 */

import { sudokuApi } from "./api";
import { flushQueuedGames } from "../_shared/flushQueuedGames";
import { scoreQueue } from "../_shared/scoreQueue";
import type { PendingSubmission } from "../_shared/types";

export function registerSudokuScoreHandler(): void {
  scoreQueue.registerHandler("sudoku", async (item: PendingSubmission) => {
    const { game_id, player_name } = item.payload as { game_id: string; player_name: string };
    if (typeof game_id !== "string" || typeof player_name !== "string") {
      // Malformed payload — drop by "succeeding" (throwing would keep retrying forever).
      return;
    }
    // On reconnect NetworkContext flushes this queue and SyncWorker together;
    // make sure the game itself has been uploaded before naming it.
    await flushQueuedGames();
    await sudokuApi.submitPlayerName(game_id, player_name);
  });
}
