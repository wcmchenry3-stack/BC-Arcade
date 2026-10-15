/**
 * Upload-on-error (#3279): an error in a game upgrades that game's replay
 * from `local` (sampled out) to `full`, whatever the sample rate.
 *
 * App.tsx calls this from Sentry's `beforeSend`, for every event Sentry is
 * about to send. It runs on that path, so it is synchronous and cheap, and it
 * never sends or changes an event and never throws.
 *
 * Which game: the event's own `game.id` tag (sessionTags.ts), stamped when the
 * error was captured — never the game open when `beforeSend` runs. On native,
 * `beforeSend` runs later (after the SDK's device-context await), by which
 * time that game may have completed and another started. The client accepts
 * a completed game until its completion has synced (gameEventClient
 * `upgradeReplay`). An event with no game (`game.id` absent or `"none"`) does
 * nothing.
 *
 * Which errors (cost, CLAUDE.md): only `error` / `fatal` events about the
 * game. Not the app's plumbing — events from `UPGRADE_IGNORED_SUBSYSTEMS`, any
 * API request event (`api` tag: network failures, 5xx, request code) and
 * forwarded `console.error` calls (`source: "console.error"`), nor a game's
 * persistence subsystems (`<game>.storage`, `.pauseStore`, `.unlocks`: a
 * device-wide storage failure). Untagged events (a crash, an ErrorBoundary)
 * and game-logic subsystems (`yacht.ai`, `starswarm.loop`, `outcomeGuard`,
 * `autoComplete`, `drag`, `hearts.integrity`, ...) count. The client also refuses any
 * upgrade while the game's sample rate is 0 (the storage-budget turn-down).
 */

import { gameEventClient } from "./gameEventClient";
import { NO_GAME } from "./sessionTags";

/**
 * Subsystems whose errors are about the app's plumbing, not the game being
 * played: an outage there would otherwise upgrade every open session.
 */
export const UPGRADE_IGNORED_SUBSYSTEMS: ReadonlySet<string> = new Set([
  "syncWorker",
  "syncApi",
  "session",
  "gameEventClient",
  "pendingGamesStore",
  "eventStore",
  "gameRecorder",
  "httpClient",
  "entitlements",
  "purchases",
  "displayNameSync",
  "displayName",
  "leaderboard",
  "leaderboardSubmit",
  "gameStats",
  "settings",
  "lastDifficulty",
  "capacityWarningToast",
]);

/**
 * A game's own persistence subsystems (`<game>.storage`, `<game>.pauseStore`,
 * `<game>.unlocks`): their failures are device storage failing, which would
 * upgrade every session at once, not the game misbehaving.
 */
const IGNORED_SUBSYSTEM_SUFFIX = /\.(storage|pauseStore|unlocks)$/;

/** Whether errors from `subsystem` never upgrade a session (see the header). */
export function isIgnoredSubsystem(subsystem: string): boolean {
  return UPGRADE_IGNORED_SUBSYSTEMS.has(subsystem) || IGNORED_SUBSYSTEM_SUFFIX.test(subsystem);
}

/** The fields of a Sentry event this reads. */
interface SentryEventLike {
  readonly level?: string;
  readonly exception?: unknown;
  readonly tags?: Readonly<Record<string, unknown>>;
}

/** The game the event is about, or null when it is not a game error worth an upgrade. */
export function upgradeTarget(event: SentryEventLike): string | null {
  // A captured exception is an error even when the event names no level.
  const level = event.level ?? (event.exception ? "error" : undefined);
  if (level !== "error" && level !== "fatal") return null;
  const tags = event.tags ?? {};
  const gameId = tags["game.id"];
  if (typeof gameId !== "string" || gameId === "" || gameId === NO_GAME) return null;
  if (tags.source === "console.error" || tags.api !== undefined) return null;
  const subsystem = tags.subsystem;
  if (typeof subsystem === "string" && isIgnoredSubsystem(subsystem)) return null;
  return gameId;
}

export function upgradeReplayOnError(event: SentryEventLike): void {
  try {
    const gameId = upgradeTarget(event);
    if (gameId !== null) gameEventClient.upgradeReplay(gameId, "error");
  } catch {
    // Never let the upgrade get in the way of the report.
  }
}
