/**
 * Star Swarm's handler for flushing queued score submissions.
 *
 * Registered once at module load by NetworkContext. Keeps queue-flush
 * logic co-located with Star Swarm rather than in a central switch.
 */

import { starSwarmApi } from "./api";
import { scoreQueue } from "../_shared/scoreQueue";
import type { PendingSubmission } from "../_shared/types";

export function registerStarSwarmScoreHandler(): void {
  scoreQueue.registerHandler("starswarm", async (item: PendingSubmission) => {
    const { player_id, score, wave_reached, difficulty_tier } = item.payload as {
      player_id: string;
      score: number;
      wave_reached: number;
      difficulty_tier: string;
    };
    if (
      typeof player_id !== "string" ||
      typeof score !== "number" ||
      typeof wave_reached !== "number" ||
      typeof difficulty_tier !== "string"
    ) {
      // Malformed payload — drop by "succeeding" (throwing would retry forever).
      return;
    }
    await starSwarmApi.submitScore(player_id, score, wave_reached, difficulty_tier);
  });
}
