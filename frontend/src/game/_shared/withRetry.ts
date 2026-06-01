/**
 * Retries an async function up to `maxRetries` times when it throws a
 * `TypeError` (the error class `fetch` uses for network-layer failures:
 * offline, DNS, CORS, "Failed to fetch"). All other error types are
 * re-thrown immediately without any retry.
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
      if (!(e instanceof TypeError)) throw e;
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, baseDelayMs * 2 ** attempt)
        );
      }
    }
  }
  throw lastError;
}
