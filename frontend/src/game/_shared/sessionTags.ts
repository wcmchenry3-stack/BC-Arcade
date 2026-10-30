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
 *
 * No tag removal reaches the native SDKs: `setTag(key, undefined)` is forwarded
 * to native as the string "undefined", and the native bridge has no remove call.
 * So the tags are never set to `undefined`; a cleared tag is set to the sentinel
 * "none" (`NO_GAME`), and `game.difficulty` is only written when the game has
 * one (and reset to "none" at the next start/clear that follows a game which
 * had one). In Sentry, filter on `game.id:none` / `!game.id:none`.
 *
 * #3510: a game may add its own per-session tags (`setGameSessionTag`, e.g. Star
 * Swarm's `starswarm.dev_affected`). They live and die with the session: set
 * only while one is tagged, reset to "none" with the `game.*` tags when it ends
 * or a new one starts, so they never leak onto another game's events.
 */

import * as Sentry from "@sentry/react-native";

/** Metadata keys games use for their difficulty, in precedence order. */
const DIFFICULTY_KEYS = ["difficulty", "ai_difficulty", "difficulty_tier"] as const;

/** What a cleared tag holds (see the module comment). */
export const NO_GAME = "none";

let taggedGameId: string | null = null;
/** Whether `game.difficulty` currently holds a real value. */
let difficultyTagged = false;
/** #3510: the game's own per-session tags currently holding a value. */
const gameTagsSet = new Set<string>();

/** The difficulty a session's start metadata names, or undefined. */
export function difficultyOf(metadata: Record<string, unknown> | undefined): string | undefined {
  if (!metadata) return undefined;
  for (const key of DIFFICULTY_KEYS) {
    const v = metadata[key];
    if (typeof v === "string" && v !== "") return v;
  }
  return undefined;
}

function setTag(key: string, value: string): void {
  try {
    Sentry.setTag(key, value);
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
  resetGameTags(); // #3510: a previous session's own tags never carry over
  taggedGameId = gameId;
  setTag("game.id", gameId);
  setTag("game.type", gameType);
  const difficulty = difficultyOf(metadata);
  if (difficulty !== undefined) {
    setTag("game.difficulty", difficulty);
    difficultyTagged = true;
  } else if (difficultyTagged) {
    // A previous game's difficulty must not linger on this one.
    setTag("game.difficulty", NO_GAME);
    difficultyTagged = false;
  }
}

/** #3510: the game's own tags back to "none" (only the ones that were set). */
function resetGameTags(): void {
  for (const key of gameTagsSet) setTag(key, NO_GAME);
  gameTagsSet.clear();
}

/**
 * #3510: a game's own tag for the session currently tagged; cleared with it. A no-op while no
 * session is tagged (nothing to tie it to), so it can never outlive one. One scope write.
 */
export function setGameSessionTag(key: string, value: string): void {
  if (taggedGameId === null) return;
  gameTagsSet.add(key);
  setTag(key, value);
}

function resetTags(): void {
  resetGameTags();
  taggedGameId = null;
  setTag("game.id", NO_GAME);
  setTag("game.type", NO_GAME);
  if (difficultyTagged) {
    setTag("game.difficulty", NO_GAME);
    difficultyTagged = false;
  }
}

/** Clear the tags if `gameId` is the tagged session (no-op otherwise). */
export function clearSessionTags(gameId: string): void {
  if (taggedGameId === null || taggedGameId !== gameId) return;
  resetTags();
}

/**
 * Clear the tags whatever session they name: for when the stores holding the
 * game are wiped (Clear logs, Delete My Data) and the id points at nothing.
 */
export function forceClearSessionTags(): void {
  if (taggedGameId === null) return;
  resetTags();
}

/** The id of the session currently tagged, or null. */
export function taggedSessionGameId(): string | null {
  return taggedGameId;
}
