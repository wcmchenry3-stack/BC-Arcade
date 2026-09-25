/**
 * Shared types for the game module.
 *
 * These types are used by the offline score queue and (eventually) by
 * every game's API client and engine. See docs for the unified game module
 * pattern.
 */

import type { GameType } from "../../api/vocab";
export type { GameType };

/**
 * A score submission waiting to be sent to the server.
 *
 * `id` is a client-generated UUID v4 that doubles as the `game_id`
 * idempotency key for backend dedupe (see issue #155). It is created
 * at enqueue time and never changes.
 */
export interface PendingSubmission {
  id: string;
  game_type: GameType;
  payload: Record<string, unknown>;
  played_at: string;
  attempts: number;
  last_error?: string;
}

/**
 * A handler that knows how to submit one queued item to the server.
 * Throwing from the handler keeps the item in the queue for a later retry.
 */
export type SubmitHandler = (item: PendingSubmission) => Promise<void>;

// ---------------------------------------------------------------------------
// Session lifecycle interfaces (#544)
// ---------------------------------------------------------------------------

/**
 * Identity and display info for a game participant.
 * Designed with multiplayer in mind — all games carry Player[] even when
 * single-player (array length = 1).
 */
export interface Player {
  id: string;
  displayName: string;
}

/**
 * A live or completed game session bound to a specific game type.
 *
 * `TState`  — the game's server-side (or local) state snapshot.
 * `TAction` — reserved for typed action dispatch via useGameSync (#549).
 *             Use the `_actionType` phantom field in per-game session types
 *             to bind this parameter without forcing runtime allocation.
 */
export interface GameSession<TState, TAction = unknown> {
  id: string;
  gameType: GameType;
  state: TState;
  status: "active" | "completed" | "abandoned";
  /**
   * Phantom field — never assigned at runtime.
   * Binds TAction so useGameSync can infer the dispatch type from a session.
   */
  readonly _actionType?: TAction;
}
