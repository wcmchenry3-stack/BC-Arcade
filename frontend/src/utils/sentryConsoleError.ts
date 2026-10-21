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
 *   - The Sentry title and fingerprint come from the FIRST argument (the
 *     printf template for React warnings), with numbers / hex ids / UUIDs
 *     replaced by `#` (an HTTP status after "HTTP"/"status"/"code" is kept) and
 *     cut to `TEMPLATE_MAX_CHARS`. When the first argument is not a message (an
 *     object, a number) or is only format specifiers ("%s"), the key is its type
 *     (an object's first few key names) plus a short label for the second
 *     argument. One issue per kind of message, not one per distinct text. The
 *     full formatted text goes in `extra.message`, cut to
 *     `CONSOLE_ERROR_EXTRA_MAX_CHARS`.
 *   - A dedicated `SentryThrottle`: one event per key per app session, at most
 *     `CONSOLE_ERROR_MAX_PER_HOUR` in any rolling hour. Its own budget, so
 *     console noise cannot starve the shared error budget other reporters use.
 *     Drops ride as `extra.sentryThrottleDropped` on the next event sent.
 *   - The throttle is checked before any argument is formatted. A dropped call
 *     costs an `instanceof` scan of the arguments, a slice of at most
 *     `NORMALIZE_INPUT_MAX_CHARS` of the first (and at most the second) and the
 *     normalise passes over that slice; no JSON.stringify, no allocation of the
 *     full message.
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
/** The most of any text the normalise passes ever scan. */
const NORMALIZE_INPUT_MAX_CHARS = 512;
/** Cap on the label of a non-message argument inside a key. */
const DETAIL_MAX_CHARS = 40;
const OBJECT_KEYS_MAX = 5;
const FORMAT_ONLY_MAX_CHARS = 32;
const FORMAT_SPECIFIERS = /%[sdifoOjc%]/g;
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

// A number right after "HTTP" / "status" / "code" that looks like an HTTP status
// keeps its value: "HTTP 404" and "HTTP 500" are different problems. At most 500
// values per template, so the key space stays bounded.
const STATUS_CONTEXT = /(?:http|status|code)\s*[:=]?\s*$/i;
const HTTP_STATUS = /^[1-5]\d\d$/;

/**
 * Replace the parts of a message that vary per call (ids, numbers) and cap its
 * length. The input is cut to `NORMALIZE_INPUT_MAX_CHARS` first, so the regex
 * passes never scan more than that, however long the logged text.
 */
function normalize(text: string, maxChars = TEMPLATE_MAX_CHARS): string {
  return text
    .slice(0, NORMALIZE_INPUT_MAX_CHARS)
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "#")
    .replace(/\b(?=[0-9a-f]*\d)[0-9a-f]{8,}\b/gi, "#")
    .replace(/\d+/g, (digits: string, offset: number, s: string) =>
      HTTP_STATUS.test(digits) && STATUS_CONTEXT.test(s.slice(Math.max(0, offset - 12), offset))
        ? digits
        : "#"
    )
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxChars);
}

function firstErrorOf(args: unknown[]): Error | undefined {
  // Cheapest check first: most error logs pass the Error as the first argument.
  if (args[0] instanceof Error) return args[0];
  return args.find((a): a is Error => a instanceof Error);
}

/** A short, low-cardinality label for an argument that is not a message string. */
function shapeOf(a: unknown): string {
  if (a === null) return "null";
  if (Array.isArray(a)) return "array";
  if (typeof a === "string") return normalize(a, DETAIL_MAX_CHARS);
  if (typeof a === "object") {
    // A plain object's top-level key names tell one call site from another; values never.
    const keys: string[] = [];
    for (const k in a as Record<string, unknown>) {
      if (keys.length >= OBJECT_KEYS_MAX) break;
      if (Object.prototype.hasOwnProperty.call(a, k)) keys.push(k);
    }
    return keys.length ? `object{${normalize(keys.join(","), DETAIL_MAX_CHARS)}}` : "object";
  }
  return typeof a;
}

/** "%s", "%o %s" and the like: a template with no words of its own. Short by nature. */
function isFormatOnly(text: string): boolean {
  return text.length <= FORMAT_ONLY_MAX_CHARS && text.replace(FORMAT_SPECIFIERS, "").trim() === "";
}

function templateOf(args: unknown[], err: Error | undefined): string {
  if (err) return normalize(`${err.name}: ${err.message.slice(0, NORMALIZE_INPUT_MAX_CHARS)}`);
  const first = args[0];
  if (typeof first === "string" && !isFormatOnly(first)) return normalize(first);
  // Not a message (an object, a number) or only a format template ("%s", "%o"):
  // key on its type plus a short label for the next argument, so these calls do
  // not all share one key.
  const head = typeof first === "string" ? normalize(first, DETAIL_MAX_CHARS) : shapeOf(first);
  return args.length > 1 ? `${head} ${shapeOf(args[1])}` : head;
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
