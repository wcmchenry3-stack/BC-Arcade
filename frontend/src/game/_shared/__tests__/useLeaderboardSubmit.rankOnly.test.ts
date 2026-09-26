/**
 * useLeaderboardSubmit with a rank-only adapter (#2677): nothing is queued,
 * and until the lookup settles the hook asks again while mounted — on
 * reconnect, and while online on a backoff timer.
 */
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Sentry from "@sentry/react-native";
import { act, renderHook } from "@testing-library/react-native";
import {
  RANK_REFETCH_DELAYS_MS,
  useLeaderboardSubmit,
  type RankLookup,
  type RankOnlyLeaderboardAdapter,
} from "../useLeaderboardSubmit";
import { resetDisplayNameCacheForTests, saveDisplayName } from "../displayName";
import { ApiError } from "../httpClient";

jest.mock("../flushQueuedGames", () => ({
  flushQueuedGames: jest.fn(() => Promise.resolve()),
}));

const mockNetwork = { isOnline: true, isInitialized: true };
jest.mock("../NetworkContext", () => ({
  useNetwork: () => mockNetwork,
}));

type Payload = { gameId: string };
const PAYLOAD: Payload = { gameId: "g-1" };

const ranked = (rank: number | null): RankLookup => ({ kind: "ranked", rank });
const PENDING: RankLookup = { kind: "pending" };
const OFFLINE_ERROR = () => new TypeError("Failed to fetch");

async function setup(submit: jest.Mock) {
  const adapter: RankOnlyLeaderboardAdapter<Payload> = {
    gameType: "sudoku",
    submit,
  };
  return renderHook(() => useLeaderboardSubmit(adapter));
}

/** Advance fake time and let the promises it releases settle. */
async function advance(ms: number) {
  await act(async () => {
    await jest.advanceTimersByTimeAsync(ms);
  });
}

async function setOnline(isOnline: boolean, rerender: (props: object) => Promise<void> | void) {
  mockNetwork.isOnline = isOnline;
  await act(async () => {
    await rerender({});
  });
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  resetDisplayNameCacheForTests();
  mockNetwork.isOnline = true;
  mockNetwork.isInitialized = true;
  jest.mocked(Sentry.captureException).mockClear();
  await saveDisplayName("Riley");
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useLeaderboardSubmit with a rank-only adapter (#2677)", () => {
  it("reports the rank without queuing anything", async () => {
    const submit = jest.fn().mockResolvedValue(ranked(2));
    const { result } = await setup(submit);
    await act(() => result.current.submit(PAYLOAD));
    expect(submit).toHaveBeenCalledWith("Riley", PAYLOAD);
    expect(result.current).toMatchObject({ status: "saved", rank: 2, playerName: "Riley" });
  });

  it("a ranked lookup without a rank is saved with no rank", async () => {
    const { result } = await setup(jest.fn().mockResolvedValue(ranked(null)));
    await act(() => result.current.submit(PAYLOAD));
    expect(result.current).toMatchObject({ status: "saved", rank: null });
  });

  it("unranked: status unranked, and it never asks again", async () => {
    const submit = jest.fn().mockResolvedValue({ kind: "unranked" });
    const { result } = await setup(submit);
    await act(() => result.current.submit(PAYLOAD));
    expect(result.current).toMatchObject({ status: "unranked", rank: null });
    await advance(10 * 60_000);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("needsName asks for a name; provideName fetches again", async () => {
    const submit = jest
      .fn()
      .mockResolvedValueOnce({ kind: "needsName" })
      .mockResolvedValue(ranked(1));
    const { result } = await setup(submit);

    await act(() => result.current.submit(PAYLOAD));
    expect(result.current.status).toBe("needsName");
    await advance(10 * 60_000);
    expect(submit).toHaveBeenCalledTimes(1);

    await act(async () => {
      await result.current.provideName("Robin");
    });
    expect(submit).toHaveBeenLastCalledWith("Robin", PAYLOAD);
    expect(result.current).toMatchObject({ status: "saved", rank: 1, playerName: "Robin" });
  });

  it("offline: no queue item; fetches on reconnect, and only once", async () => {
    mockNetwork.isOnline = false;
    const submit = jest.fn().mockResolvedValue(ranked(1));
    const { result, rerender } = await setup(submit);

    await act(() => result.current.submit(PAYLOAD));
    expect(result.current.status).toBe("offline");
    // No timer while offline.
    await advance(10 * 60_000);
    expect(submit).not.toHaveBeenCalled();

    await setOnline(true, rerender);
    expect(result.current).toMatchObject({ status: "saved", rank: 1 });
    expect(submit).toHaveBeenCalledTimes(1);

    await setOnline(false, rerender);
    await setOnline(true, rerender);
    expect(submit).toHaveBeenCalledTimes(1);
  });

  it("a network failure while NetInfo says online is retried on the timer", async () => {
    const submit = jest.fn().mockRejectedValueOnce(OFFLINE_ERROR()).mockResolvedValue(ranked(3));
    const { result } = await setup(submit);

    await act(() => result.current.submit(PAYLOAD));
    expect(result.current.status).toBe("offline");

    await advance(RANK_REFETCH_DELAYS_MS[0]! - 1);
    expect(submit).toHaveBeenCalledTimes(1);
    await advance(1);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ status: "saved", rank: 3 });
  });

  it("pending: keeps asking on a bounded backoff (5 s, 15 s, 60 s, then every 60 s)", async () => {
    const submit = jest.fn().mockResolvedValue(PENDING);
    const { result } = await setup(submit);

    await act(() => result.current.submit(PAYLOAD));
    expect(result.current.status).toBe("submitting");
    expect(RANK_REFETCH_DELAYS_MS).toEqual([5_000, 15_000, 60_000]);

    const expected = [5_000, 15_000, 60_000, 60_000, 60_000];
    for (const [i, delay] of expected.entries()) {
      await advance(delay - 1);
      expect(submit).toHaveBeenCalledTimes(i + 1);
      await advance(1);
      expect(submit).toHaveBeenCalledTimes(i + 2);
    }

    submit.mockResolvedValue(ranked(4));
    await advance(60_000);
    expect(result.current).toMatchObject({ status: "saved", rank: 4 });
    const settledCalls = submit.mock.calls.length;
    await advance(10 * 60_000);
    expect(submit).toHaveBeenCalledTimes(settledCalls);
  });

  it("a reconnect during a fetch that then fails is not lost", async () => {
    let failFirst: (e: Error) => void = () => {};
    const submit = jest
      .fn()
      .mockImplementationOnce(() => new Promise<RankLookup>((_, reject) => (failFirst = reject)))
      .mockResolvedValue(ranked(5));
    const { result, rerender } = await setup(submit);

    let inFlight: Promise<void> = Promise.resolve();
    await act(async () => {
      inFlight = result.current.submit(PAYLOAD);
    });
    // The connection drops and comes back while the first fetch is in flight.
    await setOnline(false, rerender);
    await setOnline(true, rerender);
    expect(submit).toHaveBeenCalledTimes(1);

    await act(async () => {
      failFirst(OFFLINE_ERROR());
      await inFlight;
    });
    expect(result.current.status).toBe("offline");

    await advance(RANK_REFETCH_DELAYS_MS[0]!);
    expect(submit).toHaveBeenCalledTimes(2);
    expect(result.current).toMatchObject({ status: "saved", rank: 5 });
  });

  it("an HTTP error is an error (not reported to Sentry), with no timer; retry() asks again", async () => {
    const submit = jest
      .fn()
      .mockRejectedValueOnce(new ApiError("not_entitled", 403))
      .mockResolvedValue(ranked(4));
    const { result } = await setup(submit);

    await act(() => result.current.submit(PAYLOAD));
    expect(result.current.status).toBe("error");
    expect(Sentry.captureException).not.toHaveBeenCalled();
    await advance(10 * 60_000);
    expect(submit).toHaveBeenCalledTimes(1);

    await act(() => result.current.retry());
    expect(result.current).toMatchObject({ status: "saved", rank: 4 });
  });

  it("an unexpected error is reported", async () => {
    const { result } = await setup(jest.fn().mockRejectedValue(new Error("bug")));
    await act(() => result.current.submit(PAYLOAD));
    expect(result.current.status).toBe("error");
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("reset() cancels the timer and the reconnect fetch", async () => {
    const submit = jest.fn().mockResolvedValue(PENDING);
    const { result, rerender } = await setup(submit);

    await act(() => result.current.submit(PAYLOAD));
    await act(async () => result.current.reset());
    await advance(10 * 60_000);
    await setOnline(false, rerender);
    await setOnline(true, rerender);

    expect(submit).toHaveBeenCalledTimes(1);
    expect(result.current.status).toBe("idle");
  });

  it("unmounting cancels the timer", async () => {
    const submit = jest.fn().mockResolvedValue(PENDING);
    const { result, unmount } = await setup(submit);

    await act(() => result.current.submit(PAYLOAD));
    await act(async () => unmount());
    await advance(10 * 60_000);

    expect(submit).toHaveBeenCalledTimes(1);
  });
});
