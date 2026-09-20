import { CodedError } from "expo-modules-core";
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

  it("retries on an Android offline CodedError the same as a TypeError (#2403)", async () => {
    // Expo's native fetch layer raises CodedError (not TypeError) for offline /
    // DNS failures on Android — see isNetworkError in httpClient.ts (#2380).
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new CodedError("ERR_NETWORK", "Unable to resolve host"))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("exhausts maxRetries on persistent CodedError and throws it (#2403)", async () => {
    const networkErr = new CodedError("ERR_NETWORK", "Unable to resolve host");
    const fn = jest.fn().mockRejectedValue(networkErr);

    await expect(withRetry(fn, { maxRetries: 2, baseDelayMs: 0 })).rejects.toBe(networkErr);
    expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("retries on Expo's native FetchError shape — what devices really throw (#2428)", async () => {
    // Expo's native fetch rethrows offline / DNS failures as a plain Error
    // subclass with a "fetch failed: …" message (BC_GAMES-4Y), not the bare
    // CodedError above — see isNetworkError in httpClient.ts.
    const fn = jest
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "fetch failed: UnexpectedException: A server with the specified hostname could not be found."
        )
      )
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, { maxRetries: 3, baseDelayMs: 0 });
    expect(result).toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
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
