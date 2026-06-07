/**
 * useLeaderboard — unit tests.
 *
 * Covers the retry-on-TypeError path added to defend against transient
 * network failures (#1874, #1861, #1862).
 */

import { renderHook, act, waitFor } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useLeaderboard } from "../useLeaderboard";

// ---------------------------------------------------------------------------
// Module-level mocks
// ---------------------------------------------------------------------------

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

jest.mock("../NetworkContext", () => ({
  useNetwork: () => ({ isOnline: true, isInitialized: true }),
}));

const asyncStorage = AsyncStorage as jest.Mocked<typeof AsyncStorage>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FakeData {
  scores: { rank: number }[];
}

function makeFetcher(fn: jest.Mock): () => Promise<FakeData> {
  return fn as () => Promise<FakeData>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(() => {
  jest.clearAllMocks();
  asyncStorage.getItem.mockResolvedValue(null);
  asyncStorage.setItem.mockResolvedValue(undefined);
});

describe("useLeaderboard — happy path", () => {
  it("returns data after a successful fetch", async () => {
    const data: FakeData = { scores: [{ rank: 1 }] };
    const fetcher = jest.fn().mockResolvedValue(data);

    const { result } = await renderHook(() =>
      useLeaderboard<FakeData>(makeFetcher(fetcher), "test_key")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(data);
    expect(result.current.offline).toBe(false);
  });

  it("returns cached data immediately when the cache is fresh", async () => {
    const cached: FakeData = { scores: [{ rank: 2 }] };
    asyncStorage.getItem.mockResolvedValue(JSON.stringify({ data: cached, fetchedAt: Date.now() }));
    const fetcher = jest.fn(); // should not be called

    const { result } = await renderHook(() =>
      useLeaderboard<FakeData>(makeFetcher(fetcher), "test_key")
    );

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(cached);
    expect(fetcher).not.toHaveBeenCalled();
  });
});

describe("useLeaderboard — TypeError retry", () => {
  it("retries on TypeError and resolves without marking offline", async () => {
    jest.useFakeTimers();
    const data: FakeData = { scores: [{ rank: 1 }] };
    const fetcher = jest
      .fn()
      .mockRejectedValueOnce(new TypeError("Network request failed"))
      .mockResolvedValueOnce(data);

    const { result } = await renderHook(() =>
      useLeaderboard<FakeData>(makeFetcher(fetcher), "test_key")
    );

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    expect(result.current.offline).toBe(false);
    expect(result.current.data).toEqual(data);
    expect(fetcher).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it("marks offline after all retries fail and no cache exists", async () => {
    jest.useFakeTimers();
    const fetcher = jest.fn().mockRejectedValue(new TypeError("Network request failed"));

    const { result } = await renderHook(() =>
      useLeaderboard<FakeData>(makeFetcher(fetcher), "test_key")
    );

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.offline).toBe(true);
    expect(result.current.data).toBeNull();

    jest.useRealTimers();
  });

  it("returns stale cache after all retries fail when cache exists", async () => {
    jest.useFakeTimers();
    const staleData: FakeData = { scores: [{ rank: 99 }] };
    // Cache is older than TTL so network fetch is attempted, but expired cache is still available.
    asyncStorage.getItem.mockResolvedValue(
      JSON.stringify({ data: staleData, fetchedAt: Date.now() - 10 * 60 * 1000 })
    );
    const fetcher = jest.fn().mockRejectedValue(new TypeError("Network request failed"));

    const { result } = await renderHook(() =>
      useLeaderboard<FakeData>(makeFetcher(fetcher), "test_key")
    );

    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.data).toEqual(staleData);
    expect(result.current.offline).toBe(false);

    jest.useRealTimers();
  });
});
