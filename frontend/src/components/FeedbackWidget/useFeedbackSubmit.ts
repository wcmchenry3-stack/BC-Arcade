/**
 * In-app feedback goes to Sentry User Feedback.
 *
 * It used to POST to a shared Cloudflare Worker that filed a GitHub issue. That
 * never worked on iOS / Android (the worker requires an allow-listed `Origin`
 * header, which native `fetch` does not send → 403), and where it did work it
 * published the user's text and logs in a public repository. Sentry is private,
 * already our crash-reporting processor, and needs no network handling here:
 * the SDK queues the envelope and retries when the device is back online.
 */

import { useState } from "react";
import * as Sentry from "@sentry/react-native";
import { SessionLogger } from "./SessionLogger";

export type FeedbackType = "bug" | "feature";

export interface FeedbackPayload {
  title: string;
  description: string;
  type: FeedbackType;
}

export type SubmitStatus = "idle" | "submitting" | "success" | "error";

export interface SubmitError {
  /** `unavailable`: Sentry is not initialised in this build (no DSN, test hooks). */
  kind: "rate_limit" | "unavailable";
  retryAfterSeconds?: number;
}

export interface SubmitResult {
  eventId: string;
}

export interface UseFeedbackSubmit {
  status: SubmitStatus;
  result: SubmitResult | null;
  error: SubmitError | null;
  submit: (payload: FeedbackPayload) => Promise<void>;
  reset: () => void;
}

/** Per-install throttle — nothing server-side limits feedback any more. */
export const FEEDBACK_RATE_LIMIT_MAX = 5;
export const FEEDBACK_RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;

let recentSubmissions: number[] = [];

/** Test hook. */
export function _resetFeedbackRateLimit(): void {
  recentSubmissions = [];
}

function retryAfterSeconds(now: number): number | null {
  recentSubmissions = recentSubmissions.filter((ts) => now - ts < FEEDBACK_RATE_LIMIT_WINDOW_MS);
  if (recentSubmissions.length < FEEDBACK_RATE_LIMIT_MAX) return null;
  const oldest = recentSubmissions[0] ?? now;
  return Math.ceil((FEEDBACK_RATE_LIMIT_WINDOW_MS - (now - oldest)) / 1000);
}

export function useFeedbackSubmit(): UseFeedbackSubmit {
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [result, setResult] = useState<SubmitResult | null>(null);
  const [error, setError] = useState<SubmitError | null>(null);

  async function submit(payload: FeedbackPayload): Promise<void> {
    setError(null);
    setResult(null);

    if (!Sentry.getClient()) {
      setStatus("error");
      setError({ kind: "unavailable" });
      return;
    }

    const now = Date.now();
    const retryAfter = retryAfterSeconds(now);
    if (retryAfter !== null) {
      setStatus("error");
      setError({ kind: "rate_limit", retryAfterSeconds: retryAfter });
      return;
    }

    setStatus("submitting");

    const logs = SessionLogger.getLogs();
    try {
      const eventId = Sentry.captureFeedback(
        {
          message: `${payload.title}\n\n${payload.description}`,
          source: "in_app_feedback",
          tags: { "feedback.type": payload.type },
        },
        logs
          ? {
              attachments: [
                { filename: "session-logs.txt", data: logs, contentType: "text/plain" },
              ],
            }
          : undefined
      );
      recentSubmissions.push(now);
      setResult({ eventId });
      setStatus("success");
    } catch {
      setStatus("error");
      setError({ kind: "unavailable" });
    }
  }

  function reset(): void {
    setStatus("idle");
    setResult(null);
    setError(null);
  }

  return { status, result, error, submit, reset };
}
