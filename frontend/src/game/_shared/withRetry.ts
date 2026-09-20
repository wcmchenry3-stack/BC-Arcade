import { isNetworkError } from "./httpClient";

/**
 * Retries an async function up to `maxRetries` times when it throws a
 * network-layer failure as classified by `isNetworkError` — `TypeError` from
 * `fetch` on web (offline, DNS, CORS, "Failed to fetch") or, on iOS / Android,
 * the "fetch failed: …" error Expo's native fetch raises for the same
 * conditions (#2403, #2428). All other error types are re-thrown immediately
 * without any retry.
 *
 * The check is intentionally broad — any TypeError/CodedError triggers a
 * retry, not just those from `fetch`. All current call sites are thin API wrappers, so
 * this is safe in practice; avoid wrapping logic that can throw either class
 * from non-network sources.
 *
 * Exponential back-off: baseDelayMs × 2^attempt (500 ms → 1 s → 2 s).
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  { maxRetries = 3, baseDelayMs = 500 }: { maxRetries?: number; baseDelayMs?: number } = {}
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      if (!isNetworkError(e)) throw e;
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise<void>((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
      }
    }
  }
  throw lastError;
}
