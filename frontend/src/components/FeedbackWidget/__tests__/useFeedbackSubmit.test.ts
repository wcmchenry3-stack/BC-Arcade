import { renderHook, act } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import {
  _resetFeedbackRateLimit,
  FEEDBACK_RATE_LIMIT_MAX,
  FEEDBACK_RATE_LIMIT_WINDOW_MS,
  useFeedbackSubmit,
} from "../useFeedbackSubmit";
import { SessionLogger } from "../SessionLogger";

const mockCaptureFeedback = Sentry.captureFeedback as jest.Mock;
const mockGetClient = Sentry.getClient as jest.Mock;
const mockFetch = jest.fn();

beforeEach(() => {
  mockCaptureFeedback.mockReset().mockReturnValue("event-id-1");
  mockGetClient.mockReset().mockReturnValue({});
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
  _resetFeedbackRateLimit();
  SessionLogger._reset();
});

afterEach(() => {
  jest.useRealTimers();
  SessionLogger._reset();
});

const basePayload = {
  title: "Test title",
  description: "Test description",
  type: "bug" as const,
};

describe("useFeedbackSubmit", () => {
  it("starts idle with no result or error", async () => {
    const { result } = await renderHook(() => useFeedbackSubmit());
    expect(result.current.status).toBe("idle");
    expect(result.current.result).toBeNull();
    expect(result.current.error).toBeNull();
  });

  describe("successful submission", () => {
    it("sends title, description and type to Sentry User Feedback", async () => {
      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit({ ...basePayload, type: "feature" });
      });

      expect(result.current.status).toBe("success");
      expect(result.current.result).toEqual({ eventId: "event-id-1" });
      expect(mockCaptureFeedback).toHaveBeenCalledTimes(1);
      expect(mockCaptureFeedback.mock.calls[0][0]).toEqual({
        message: "Test title\n\nTest description",
        source: "in_app_feedback",
        tags: { "feedback.type": "feature" },
      });
    });

    it("never sends a name or email — the app has none", async () => {
      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });
      const params = mockCaptureFeedback.mock.calls[0][0];
      expect(params).not.toHaveProperty("name");
      expect(params).not.toHaveProperty("email");
    });

    it("never calls the old feedback worker or any other HTTP endpoint", async () => {
      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("attaches the session logs when there are any", async () => {
      SessionLogger.init();
      console.warn("something odd happened");

      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });

      const hint = mockCaptureFeedback.mock.calls[0][1];
      expect(hint.attachments).toHaveLength(1);
      expect(hint.attachments[0]).toMatchObject({
        filename: "session-logs.txt",
        contentType: "text/plain",
      });
      expect(hint.attachments[0].data).toContain("something odd happened");
    });

    it("sends no attachment when the log buffer is empty", async () => {
      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });
      expect(mockCaptureFeedback.mock.calls[0][1]).toBeUndefined();
    });
  });

  describe("unavailable", () => {
    it("reports an error instead of a false success when Sentry is not initialised", async () => {
      mockGetClient.mockReturnValue(undefined);
      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ kind: "unavailable" });
      expect(mockCaptureFeedback).not.toHaveBeenCalled();
    });

    it("reports an error when captureFeedback throws", async () => {
      mockCaptureFeedback.mockImplementation(() => {
        throw new Error("boom");
      });
      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });

      expect(result.current.status).toBe("error");
      expect(result.current.error).toEqual({ kind: "unavailable" });
    });
  });

  describe("rate limit", () => {
    async function submitTimes(n: number) {
      const { result } = await renderHook(() => useFeedbackSubmit());
      for (let i = 0; i < n; i++) {
        await act(async () => {
          await result.current.submit(basePayload);
        });
      }
      return result;
    }

    it("blocks the submission after the limit and says when to retry", async () => {
      const result = await submitTimes(FEEDBACK_RATE_LIMIT_MAX + 1);

      expect(mockCaptureFeedback).toHaveBeenCalledTimes(FEEDBACK_RATE_LIMIT_MAX);
      expect(result.current.status).toBe("error");
      expect(result.current.error?.kind).toBe("rate_limit");
      expect(result.current.error?.retryAfterSeconds).toBeGreaterThan(0);
      expect(result.current.error?.retryAfterSeconds).toBeLessThanOrEqual(
        FEEDBACK_RATE_LIMIT_WINDOW_MS / 1000
      );
    });

    it("allows submissions again once the window has passed", async () => {
      jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate", "queueMicrotask"] });
      jest.setSystemTime(new Date("2026-09-20T12:00:00Z"));
      const result = await submitTimes(FEEDBACK_RATE_LIMIT_MAX);

      jest.setSystemTime(new Date(Date.now() + FEEDBACK_RATE_LIMIT_WINDOW_MS + 1000));
      await act(async () => {
        await result.current.submit(basePayload);
      });

      expect(result.current.status).toBe("success");
      expect(mockCaptureFeedback).toHaveBeenCalledTimes(FEEDBACK_RATE_LIMIT_MAX + 1);
    });

    it("does not count a failed submission against the limit", async () => {
      mockGetClient.mockReturnValue(undefined);
      await submitTimes(FEEDBACK_RATE_LIMIT_MAX);
      mockGetClient.mockReturnValue({});

      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });
      expect(result.current.status).toBe("success");
    });
  });

  describe("reset", () => {
    it("returns to idle", async () => {
      const { result } = await renderHook(() => useFeedbackSubmit());
      await act(async () => {
        await result.current.submit(basePayload);
      });
      await act(async () => {
        result.current.reset();
      });
      expect(result.current.status).toBe("idle");
      expect(result.current.result).toBeNull();
      expect(result.current.error).toBeNull();
    });
  });
});
