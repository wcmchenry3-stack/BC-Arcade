/**
 * Upload-on-error (#3279): an error while a game is open upgrades its replay
 * from `local` (sampled out) to `full`, whatever the sample rate.
 *
 * App.tsx calls this from Sentry's `beforeSend`, for every event Sentry is
 * about to send. It runs on that path, so it is synchronous and cheap: a level
 * check, the open game's id (`taggedSessionGameId`) and
 * `gameEventClient.upgradeReplay` — a flag set in memory, its write
 * fire-and-forget. It never sends or changes an event and never throws.
 */

import { gameEventClient } from "./gameEventClient";
import { taggedSessionGameId } from "./sessionTags";

/** The fields of a Sentry event this reads. */
interface SentryEventLike {
  readonly level?: string;
  readonly exception?: unknown;
}

export function upgradeReplayOnError(event: SentryEventLike): void {
  try {
    // A captured exception is an error even when the event names no level.
    const level = event.level ?? (event.exception ? "error" : undefined);
    if (level !== "error" && level !== "fatal") return;
    gameEventClient.upgradeReplay(taggedSessionGameId(), "error");
  } catch {
    // Never let the upgrade get in the way of the report.
  }
}
