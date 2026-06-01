import { withRetry } from "../withRetry";

describe("withRetry", () => {
  it("returns the result on first success without retrying", async () => {
    const fn = jest.fn().mockResolvedValue("ok");
    const result = await withRetry(fn, { baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("retries once on TypeError and returns on second success", async () => {
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts maxRetries on persistent TypeError and throws", async () => {
    const networkErr = new TypeError("Network request failed");
    const fn = jest.fn().mockRejectedValue(networkErr);

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 0 })).rejects.toBe(networkErr);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("throws immediately on non-TypeError errors without retrying", async () => {
    const apiErr = new Error("ApiError: 404");
    const fn = jest.fn().mockRejectedValue(apiErr);

    await expect(withRetry(fn, { maxRetries: 3, baseDelayMs: 0 })).rejects.toBe(apiErr);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects maxRetries = 0 (no retries at all)", async () => {
    const fn = jest.fn().mockRejectedValue(new TypeError("fail"));
    await expect(withRetry(fn, { maxRetries: 0, baseDelayMs: 0 })).rejects.toBeInstanceOf(
      TypeError
    );
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("respects positive baseDelayMs: runs all retries and rejects with fake timers", async () => {
    jest.useFakeTimers();

    const networkErr = new TypeError("fail");
    const fn = jest.fn().mockRejectedValue(networkErr);

    // Attach .catch immediately so Node never sees an unhandled rejection while
    // fake timers are draining — the rejection happens inside runAllTimersAsync()
    // before the outer `await expect(...)` handler is registered.
    let caughtError: unknown;
    const promise = withRetry(fn, { maxRetries: 2, baseDelayMs: 500 }).catch((e) => {
      caughtError = e;
    });

    await jest.runAllTimersAsync();
    await promise;

    expect(caughtError).toBe(networkErr);
    expect(fn).toHaveBeenCalledTimes(3); // 1 initial + 2 retries

    jest.useRealTimers();
  });
});
