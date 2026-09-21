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

import { createGameClient, isNetworkError } from "../_shared/httpClient";

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
  /**
   * The number to reach (or stay under) for the kinds that have one; else null.
   * In display units: the wire sends time limits (`*duration_ms*` kinds) in
   * milliseconds and this is minutes, so the card never needs to know the wire unit.
   */
  readonly target: number | null;
  readonly completed: boolean;
}

export interface DailyChallenge {
  readonly challengeId: string;
  readonly goals: readonly ChallengeGoal[];
  /**
   * True when `/status` could not be read and this is only the free slate from
   * `/today`, with no progress. A consumer that already holds a real challenge
   * should keep it rather than replace it with this.
   */
  readonly isFallback?: boolean;
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

const MS_PER_MINUTE = 60_000;

function toGoal(goal: WireGoal, completed: boolean): ChallengeGoal {
  const isDuration = goal.kind.includes("duration_ms");
  const target =
    typeof goal.target === "number" && isDuration
      ? Math.round((goal.target / MS_PER_MINUTE) * 100) / 100
      : (goal.target ?? null);
  return { id: goal.id, gameSlug: goal.game_type, kind: goal.kind, target, completed };
}

/** Throws on a body that is not the `/status` contract, so the caller can degrade to `/today`. */
function fromStatus(status: WireStatus): DailyChallenge {
  if (!Array.isArray(status.goals)) throw new Error("daily-challenge /status has no goals");
  return {
    challengeId: status.challenge_id,
    goals: status.goals.map((goal) => {
      if (typeof goal.completed !== "boolean") {
        throw new Error("daily-challenge /status goal has no completed flag");
      }
      return toGoal(goal, goal.completed);
    }),
  };
}

function fromToday(today: WireToday): DailyChallenge {
  return {
    challengeId: today.challenge_id,
    goals: today.goals.map((goal) => toGoal(goal, false)),
    isFallback: true,
  };
}

export const dailyChallengeApi = {
  /**
   * Today's challenge with the caller's progress, for the local day
   * `tzOffsetMinutes` east of UTC.
   *
   * Asks `/status`. If the server answers but `/status` fails or is not the shape
   * this build expects, it degrades to the public free slate from `/today` (marked
   * `isFallback`, every goal not done). A network error is rethrown untouched:
   * `/today` would fail the same way, and the caller's retry/backoff and its
   * offline state depend on seeing it once, not twice.
   */
  getDailyChallenge: async (tzOffsetMinutes: number): Promise<DailyChallenge> => {
    const query = `?tz_offset_minutes=${tzOffsetMinutes}`;
    try {
      return fromStatus(await request<WireStatus>(`/daily-challenge/status${query}`));
    } catch (e) {
      if (isNetworkError(e)) throw e;
      return fromToday(await request<WireToday>(`/daily-challenge/today${query}`));
    }
  },
};
