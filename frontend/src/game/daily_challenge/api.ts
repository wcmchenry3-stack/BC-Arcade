/**
 * Daily cross-game challenge API client (#2392, #2455).
 *
 * The UI consumes only the normalised `DailyChallenge` model below. Everything
 * that depends on the backend's wire format — endpoint paths, field names, and
 * which of the two endpoints a goal list comes from — lives in this file.
 *
 * Wire contract (`backend/daily_challenge/schemas.py`):
 *  - `GET /daily-challenge/status` — session-scoped: the goals from the slate
 *    that session resolves to (free or premium) plus which it has met. This is
 *    the source of truth for what the card shows.
 *  - `GET /daily-challenge/today` — public, no session, always the FREE slate.
 *    Only a fallback for when `/status` fails, so the card can still name the
 *    day's goals (without progress).
 * A premium session's two responses can describe different goals, so the goal
 * list is never built from one and its completion read from the other.
 */

import { createGameClient } from "../_shared/httpClient";

const request = createGameClient({ apiTag: "daily_challenge" });

// ---------------------------------------------------------------------------
// Model the UI consumes — stable, independent of the wire format
// ---------------------------------------------------------------------------

export interface ChallengeGoal {
  readonly id: string;
  /** Backend `game_type` slug — also the i18n namespace holding the game's title. */
  readonly gameSlug: string;
  /**
   * The backend's per-game goal vocabulary, e.g. `won`, `moves_at_least`,
   * `highest_tile_at_least`. Meaningful only together with `gameSlug`; the card
   * words it as `goal.<gameSlug>.<kind>`.
   */
  readonly kind: string;
  /** The number to reach (or stay under) for the kinds that have one; else null. */
  readonly target: number | null;
  readonly completed: boolean;
}

export interface DailyChallenge {
  readonly challengeId: string;
  readonly goals: readonly ChallengeGoal[];
}

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

interface WireGoal {
  readonly id: string;
  readonly game_type: string;
  readonly kind: string;
  readonly target: number | null;
}

interface WireGoalStatus extends WireGoal {
  readonly completed: boolean;
}

interface WireToday {
  readonly challenge_id: string;
  readonly goals: readonly WireGoal[];
}

interface WireStatus {
  readonly challenge_id: string;
  readonly goals: readonly WireGoalStatus[];
}

function toDailyChallenge(
  challengeId: string,
  goals: readonly (WireGoal & { readonly completed?: boolean })[]
): DailyChallenge {
  return {
    challengeId,
    goals: goals.map((goal) => ({
      id: goal.id,
      gameSlug: goal.game_type,
      kind: goal.kind,
      target: goal.target ?? null,
      completed: goal.completed ?? false,
    })),
  };
}

export const dailyChallengeApi = {
  /**
   * Today's challenge with the caller's progress, for the local day
   * `tzOffsetMinutes` east of UTC.
   *
   * Asks `/status` first. Only if that fails does it fall back to the public
   * free slate from `/today` (every goal shown as not done); if that fails too,
   * its error is the one thrown, so the caller can tell offline from a server fault.
   */
  getDailyChallenge: async (tzOffsetMinutes: number): Promise<DailyChallenge> => {
    const query = `?tz_offset_minutes=${tzOffsetMinutes}`;
    try {
      const status = await request<WireStatus>(`/daily-challenge/status${query}`);
      return toDailyChallenge(status.challenge_id, status.goals);
    } catch {
      const today = await request<WireToday>(`/daily-challenge/today${query}`);
      return toDailyChallenge(today.challenge_id, today.goals);
    }
  },
};
