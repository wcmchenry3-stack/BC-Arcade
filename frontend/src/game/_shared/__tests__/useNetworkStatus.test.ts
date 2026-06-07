import { renderHook, act, waitFor } from "@testing-library/react-native";
import type { NetInfoState } from "@react-native-community/netinfo";
import { useNetworkStatus } from "../useNetworkStatus";

type Listener = (state: NetInfoState) => void;

// Jest requires these names to start with "mock" so they can be referenced
// from inside the hoisted jest.mock factory.
const mockListeners: Listener[] = [];
let mockFetchResult: Partial<NetInfoState> = { isConnected: true, isInternetReachable: true };

jest.mock("@react-native-community/netinfo", () => ({
  __esModule: true,
  default: {
    addEventListener: (listener: Listener) => {
      mockListeners.push(listener);
      return () => {
        const i = mockListeners.indexOf(listener);
        if (i !== -1) mockListeners.splice(i, 1);
      };
    },
    fetch: () => Promise.resolve(mockFetchResult as NetInfoState),
  },
}));

describe("useNetworkStatus", () => {
  beforeEach(() => {
    mockListeners.length = 0;
    mockFetchResult = { isConnected: true, isInternetReachable: true };
  });

  it("starts online/uninitialized, becomes initialized after first event", async () => {
    // v14: effects flush before renderHook resolves, so the pre-initialization
    // state (isInitialized: false) is not observable. Verify post-init state.
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.isOnline).toBe(true);
  });

  it("reports offline when isConnected is false", async () => {
    mockFetchResult = { isConnected: false, isInternetReachable: false };
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.isOnline).toBe(false);
  });

  it("reports online when isConnected true + isInternetReachable null", async () => {
    mockFetchResult = { isConnected: true, isInternetReachable: null };
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    expect(result.current.isOnline).toBe(true);
  });

  it("updates on listener events", async () => {
    const { result } = await renderHook(() => useNetworkStatus());
    await waitFor(() => expect(result.current.isInitialized).toBe(true));
    await act(() => {
      mockListeners.forEach((l) =>
        l({ isConnected: false, isInternetReachable: false } as NetInfoState)
      );
    });
    expect(result.current.isOnline).toBe(false);
    await act(() => {
      mockListeners.forEach((l) =>
        l({ isConnected: true, isInternetReachable: true } as NetInfoState)
      );
    });
    expect(result.current.isOnline).toBe(true);
  });
});
