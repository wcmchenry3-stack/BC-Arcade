/**
 * Daily cross-game challenge API client (#2392).
 *
 * The UI consumes only the normalised `DailyChallenge` model below. Everything
 * that depends on the backend's wire format — endpoint paths, field names, the
 * split between the public definition (`/today`) and the session-scoped
 * completion (`/status`) — lives in this file, so adopting the published
 * backend contract means editing this file and nothing else.
 *
 * PROVISIONAL: the `Wire*` shapes and paths are a best guess from the plan
 * (`docs/RELEASE-PLAN-2026-10.md` §C), written before the backend contract was
 * published. Reconcile them with the real contract when it lands.
 */

import { createGameClient } from "../_shared/httpClient";

const request = createGameClient({ apiTag: "daily_challenge" });

// ---------------------------------------------------------------------------
// Model the UI consumes — stable, independent of the wire format
// ---------------------------------------------------------------------------

/** `complete`: finish one game. `score_at_least`: finish one game with `target`+ points. */
export type GoalKind = "complete" | "score_at_least";

export interface ChallengeGoal {
  readonly id: string;
  /** Backend `game_type` slug — also the i18n namespace holding the game's title. */
  readonly gameSlug: string;
  readonly kind: GoalKind;
  /** Score to reach; only set for `score_at_least`. */
  readonly target: number | null;
  readonly completed: boolean;
}

export interface DailyChallenge {
  readonly challengeId: string;
  readonly goals: readonly ChallengeGoal[];
}

// ---------------------------------------------------------------------------
// Wire format (provisional)
// ---------------------------------------------------------------------------

interface WireGoal {
  readonly id: string;
  readonly game_type: string;
  readonly kind: GoalKind;
  readonly target?: number | null;
}

interface WireToday {
  readonly challenge_id: string;
  readonly goals: readonly WireGoal[];
}

interface WireStatus {
  readonly challenge_id: string;
  readonly completed_goal_ids: readonly string[];
}

function toDailyChallenge(today: WireToday, status: WireStatus): DailyChallenge {
  // A day rollover between the two requests leaves them describing different
  // challenges; completion for the other day says nothing about this one.
  const done = new Set(status.challenge_id === today.challenge_id ? status.completed_goal_ids : []);
  return {
    challengeId: today.challenge_id,
    goals: today.goals.map((goal) => ({
      id: goal.id,
      gameSlug: goal.game_type,
      kind: goal.kind,
      target: goal.target ?? null,
      completed: done.has(goal.id),
    })),
  };
}

export const dailyChallengeApi = {
  /** Today's challenge with the caller's progress, for the local day `tzOffsetMinutes` east of UTC. */
  getDailyChallenge: async (tzOffsetMinutes: number): Promise<DailyChallenge> => {
    const query = `?tz_offset_minutes=${tzOffsetMinutes}`;
    const [today, status] = await Promise.all([
      request<WireToday>(`/daily-challenge/today${query}`),
      request<WireStatus>(`/daily-challenge/status${query}`),
    ]);
    return toDailyChallenge(today, status);
  },
};
