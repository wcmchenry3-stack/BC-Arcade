/**
 * The one rule every recorded outcome follows (#2642, epic #2519 decision 11):
 * a game with no winner (`HAS_WINNER[game]` false, from its backend module's
 * `has_winner`) records only lifecycle outcomes — `completed`, `kept_playing`,
 * `abandoned` — never `win` / `loss` / `push`.
 *
 * `assertOutcomeAllowed` runs everywhere a game row's outcome leaves the app:
 *
 *   - `useGameSync`'s `complete()`, its own abandon (unmount, `restart()`,
 *     `close()`), and the `win` a progress snapshot reports (checked on every
 *     player-activity ping, before it is mirrored to the device);
 *   - `gameEventClient.completeGame`, which every one of those goes through,
 *     as does the killed-session sweep (#2654), which can record the `win` a
 *     snapshot left on the device.
 *
 * In development and tests a violation throws, so the screen suites fail on
 * any finish path they drive that breaks the rule. In production it changes
 * nothing that is sent (the backend stores whatever the app sends, and a
 * rejected completion would dead-letter the row): it reports to Sentry once
 * per game and outcome, and returns.
 */

import * as Sentry from "@sentry/react-native";
import { GAME_TYPES, HAS_WINNER, RESULT_OUTCOMES, type GameType } from "../../api/vocab";

/** Thrown in development and tests when a game with no winner records a result outcome. */
export class OutcomeNotAllowedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OutcomeNotAllowedError";
  }
}

/** Where the outcome was about to be written, for the error and the Sentry tag. */
export type OutcomePath = "complete" | "abandon" | "progressSnapshot" | "client.completeGame";

function isGameType(value: string): value is GameType {
  return (GAME_TYPES as readonly string[]).includes(value);
}

/**
 * Whether `gameType` may record `outcome`. Lifecycle outcomes (and a missing
 * one) are always allowed; a result outcome needs a game with a winner. An
 * unknown game type has no declared rule, so nothing is refused for it.
 */
export function isOutcomeAllowed(gameType: string, outcome: unknown): boolean {
  if (!(RESULT_OUTCOMES as readonly unknown[]).includes(outcome)) return true;
  return !isGameType(gameType) || HAS_WINNER[gameType];
}

let strictOverride: boolean | null = null;
const reported = new Set<string>();

function isStrict(): boolean {
  if (strictOverride !== null) return strictOverride;
  return (typeof __DEV__ !== "undefined" && __DEV__) || process.env.NODE_ENV === "test";
}

/**
 * Check one outcome about to be recorded for `gameType` (see the module doc).
 * Throws `OutcomeNotAllowedError` in development and tests; in production
 * reports the first violation per game and outcome to Sentry and returns.
 */
export function assertOutcomeAllowed(gameType: string, outcome: unknown, path: OutcomePath): void {
  if (isOutcomeAllowed(gameType, outcome)) return;
  const message =
    `${gameType} has no winner (has_winner is false) but recorded "${String(outcome)}" ` +
    `(${path}). A game with no winner records only completed, kept_playing or abandoned.`;
  if (isStrict()) throw new OutcomeNotAllowedError(message);
  const key = `${gameType}:${String(outcome)}`;
  if (reported.has(key)) return;
  reported.add(key);
  Sentry.captureMessage(`outcomeGuard: ${message}`, {
    level: "warning",
    tags: { subsystem: "outcomeGuard", gameType, outcome: String(outcome), path },
  });
}

/** Tests only: force production (`false`) or strict (`true`) behaviour; `null` restores it. */
export function setOutcomeGuardStrictForTests(strict: boolean | null): void {
  strictOverride = strict;
  reported.clear();
}
