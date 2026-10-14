/**
 * Sentry session tags (#3277, epic #3273).
 *
 * While a game session is open, every Sentry event carries `game.id`,
 * `game.type` and `game.difficulty` (only for games that have one), so a
 * Sentry issue leads straight to the game's recorded events
 * (`backend/scripts/replay_game.py <game_id>`).
 *
 * Set once when a session starts or resumes, cleared when it ends — never per
 * event, no storage, no network. Only one session is open at a time: the tags
 * follow the most recently started one, and a clear only takes effect for the
 * id that is currently tagged (an orphan sweep or an older session ending
 * must not strip a newer session's tags). The id is a random UUID and the
 * type/difficulty are fixed vocabulary: no personal data.
 */

import * as Sentry from "@sentry/react-native";

/** Metadata keys games use for their difficulty, in precedence order. */
const DIFFICULTY_KEYS = ["difficulty", "ai_difficulty", "difficulty_tier"] as const;

let taggedGameId: string | null = null;

/** The difficulty a session's start metadata names, or undefined. */
export function difficultyOf(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  for (const key of DIFFICULTY_KEYS) {
    const v = metadata[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

function setTag(key: string, value: string | undefined): void {
  try {
    // Sentry removes a tag set to undefined from later events.
    Sentry.setTag(key, value as string);
  } catch {
    // Isolation: telemetry must never break a game.
  }
}

/** Tag Sentry with the session that just started or resumed. */
export function setSessionTags(
  gameId: string,
  gameType: string,
  metadata?: Record<string, unknown>
): void {
  taggedGameId = gameId;
  setTag("game.id", gameId);
  setTag("game.type", gameType);
  // Always written, so a previous session's difficulty never lingers.
  setTag("game.difficulty", difficultyOf(metadata));
}

/** Clear the tags if `gameId` is the tagged session (no-op otherwise). */
export function clearSessionTags(gameId: string): void {
  if (taggedGameId === null || taggedGameId !== gameId) return;
  taggedGameId = null;
  setTag("game.id", undefined);
  setTag("game.type", undefined);
  setTag("game.difficulty", undefined);
}

/** The id of the session currently tagged, or null. */
export function taggedSessionGameId(): string | null {
  return taggedGameId;
}
