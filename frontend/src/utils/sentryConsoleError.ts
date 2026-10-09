/**
 * Forwards `console.error` calls to Sentry as `captureMessage` events.
 *
 * @sentry/react-native v7 does not re-export `captureConsoleIntegration`
 * from the bundled core, so we install a small manual wrapper instead.
 * This captures React warnings (duplicate keys, invalid prop types, etc.)
 * that go through `console.error` and would otherwise never reach Sentry.
 *
 * Call AFTER `Sentry.init(...)` and after `SessionLogger.init()`. Composes
 * with SessionLogger: our wrapper sits above SessionLogger's, so calls flow
 *   patched console.error → Sentry forwarder → SessionLogger's wrapper → real console.error
 * `Sentry.captureException` does not route through `console.error`, so
 * errors captured explicitly are not double-reported here.
 */

import * as Sentry from "@sentry/react-native";

let installed = false;
let originalError: typeof console.error | null = null;

function formatArg(a: unknown): string {
  if (typeof a === "string") return a;
  if (a instanceof Error) return `${a.name}: ${a.message}`;
  try {
    return JSON.stringify(a);
  } catch {
    return String(a);
  }
}

export function installSentryConsoleErrorCapture(): void {
  if (installed) return;
  installed = true;
  originalError = console.error.bind(console);

  console.error = (...args: unknown[]) => {
    try {
      const message = args.map(formatArg).join(" ");
      const firstError = args.find((a): a is Error => a instanceof Error);
      if (firstError) {
        Sentry.captureException(firstError, {
          tags: { source: "console.error" },
          extra: { message },
        });
      } else {
        Sentry.captureMessage(message, {
          level: "error",
          tags: { source: "console.error" },
        });
      }
    } catch {
      // Never let capture failures swallow the original log.
    }
    originalError!(...args);
  };
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
}
