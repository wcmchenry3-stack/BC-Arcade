/**
 * Forwards `console.error` calls to Sentry, throttled (#3313).
 *
 * @sentry/react-native v7 does not re-export `captureConsoleIntegration`
 * from the bundled core, so we install a small manual wrapper instead.
 * This captures React warnings (duplicate keys, invalid prop types, etc.)
 * that go through `console.error` and would otherwise never reach Sentry.
 *
 * Cost (CLAUDE.md priority 1, epic #3273): `console.error` can fire in a loop
 * (a render warning on every frame, a retry loop), and its text varies (ids,
 * counts). So:
 *   - The Sentry title and fingerprint come from the FIRST argument only (the
 *     printf template for React warnings), with numbers / hex ids / UUIDs
 *     replaced by `#` and cut to `TEMPLATE_MAX_CHARS`. One issue per kind of
 *     message, not one per distinct text. The full formatted text goes in
 *     `extra.message`, cut to `CONSOLE_ERROR_EXTRA_MAX_CHARS`.
 *   - A dedicated `SentryThrottle`: one event per key per app session, at most
 *     `CONSOLE_ERROR_MAX_PER_HOUR` in any rolling hour. Its own budget, so
 *     console noise cannot starve the shared error budget other reporters use.
 *     Drops ride as `extra.sentryThrottleDropped` on the next event sent.
 *   - The throttle is checked before any argument is formatted, so a call that
 *     is dropped costs one short regex on the first argument and nothing else.
 *
 * Call AFTER `Sentry.init(...)` and after `SessionLogger.init()`. Composes
 * with SessionLogger: our wrapper sits above SessionLogger's, so calls flow
 *   patched console.error → Sentry forwarder → SessionLogger's wrapper → real console.error
 * `Sentry.captureException` does not route through `console.error`, so
 * errors captured explicitly are not double-reported here.
 */

import * as Sentry from "@sentry/react-native";
import { SentryThrottle } from "../game/_shared/sentryThrottle";

export const CONSOLE_ERROR_MAX_PER_HOUR = 10;
export const CONSOLE_ERROR_EXTRA_MAX_CHARS = 1000;
const TEMPLATE_MAX_CHARS = 120;
const SOURCE_TAG = { source: "console.error" };

let installed = false;
let originalError: typeof console.error | null = null;
let throttle = new SentryThrottle({ maxPerHour: CONSOLE_ERROR_MAX_PER_HOUR });

function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

/** Replace the parts of a message that vary per call (ids, numbers) and cap its length. */
function normalize(text: string): string {
  return text
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, "#")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, TEMPLATE_MAX_CHARS);
}

function firstErrorOf(args: unknown[]): Error | undefined {
  return args.find((a): a is Error => a instanceof Error);
}

function templateOf(args: unknown[], err: Error | undefined): string {
  if (err) return normalize(`${err.name}: ${err.message}`);
  const first = args[0];
  return normalize(typeof first === "string" ? first : typeof first);
}

/**
 * The throttle key and Sentry fingerprint for a `console.error` call: stable
 * across calls that differ only in later arguments, numbers or ids.
 */
export function consoleErrorKey(args: unknown[]): string {
  return `console.error:${templateOf(args, firstErrorOf(args))}`;
}

function forward(args: unknown[]): void {
  const err = firstErrorOf(args);
  const template = templateOf(args, err);
  const key = `console.error:${template}`;
  if (!throttle.allow(key, "error")) return;

  const dropped = throttle.takeDroppedSinceLast();
  const extra: Record<string, unknown> = {
    message: args.map(formatArg).join(" ").slice(0, CONSOLE_ERROR_EXTRA_MAX_CHARS),
  };
  if (dropped > 0) extra.sentryThrottleDropped = dropped;

  if (err) {
    // Keep captureException so the stack survives; Sentry groups it by stack.
    Sentry.captureException(err, { tags: SOURCE_TAG, extra });
  } else {
    const title = "console.error: " + template;
    Sentry.captureMessage(title, {
      level: "error",
      fingerprint: [key],
      tags: SOURCE_TAG,
      extra,
    });
  }
}

export function installSentryConsoleErrorCapture(): void {
  if (installed) return;
  installed = true;
  originalError = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    try {
      forward(args);
    } catch {
      // Never let capture failures swallow the original log.
    }
    originalError!(...args);
  };
}

/**
 * Test-only: a fresh console.error throttle, optionally on a fake clock.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function _resetConsoleErrorThrottleForTests(now?: () => number): void {
  throttle = new SentryThrottle({ maxPerHour: CONSOLE_ERROR_MAX_PER_HOUR, now });
}

/**
 * Test-only: restore the original console.error and reset install flag.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function _resetSentryConsoleErrorCaptureForTests(): void {
  if (installed && originalError) {
    console.error = originalError;
  }
  installed = false;
  originalError = null;
  _resetConsoleErrorThrottleForTests();
}
