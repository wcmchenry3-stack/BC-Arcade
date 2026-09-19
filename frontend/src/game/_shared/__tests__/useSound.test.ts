import { renderHook, act } from "@testing-library/react-native";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { SoundProvider } from "../SoundContext";
import { useSound } from "../useSound";

const mockPlay = jest.fn();
const mockSeekTo = jest.fn();
const mockRemove = jest.fn();

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({
    play: mockPlay,
    seekTo: mockSeekTo,
    remove: mockRemove,
  })),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(SoundProvider, null, children);
}

const EMPTY_REGISTRY: Record<string, number> = {};
const TEST_REGISTRY: Record<string, number> = { "test.beep": 1 as unknown as number };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useSound — unregistered key", () => {
  it("play() is a no-op when key has no entry in registry", async () => {
    const { result } = await renderHook(() => useSound("unknown.key", EMPTY_REGISTRY), { wrapper });
    await act(() => {
      result.current.play();
    });
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe("useSound — registered key", () => {
  it("play() calls seekTo(0) then play() on the audio player", async () => {
    const { result } = await renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });
    await act(() => {
      result.current.play();
    });
    expect(mockSeekTo).toHaveBeenCalledWith(0);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("play() is a no-op when muted", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("true");

    const { result } = await renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });
    // Wait for AsyncStorage to resolve
    await act(async () => {});
    await act(() => {
      result.current.play();
    });
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("returns a stable play reference across re-renders", async () => {
    const { result, rerender } = await renderHook(() => useSound("test.beep", TEST_REGISTRY), {
      wrapper,
    });
    const first = result.current.play;
    await rerender({});
    expect(result.current.play).toBe(first);
  });

  it("calls remove() on the player when unmounted", async () => {
    const { unmount } = await renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });
    await unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});

// #2410: Star Swarm's Lightning power-up calls play() up to ~14x/sec (SUPER_SHOOT_COOLDOWN).
// Each call used to spawn its own seekTo()→play() promise chain against the single shared
// player with no coordination, so a burst of rapid calls could stack up overlapping pending
// chains — extra native-bridge round trips competing with the same JS thread driving the
// game's RAF loop, visible as stutter specifically while Lightning is active.
describe("useSound — overlapping play() calls (#2410)", () => {
  it("drops a play() call that arrives while a previous seekTo/play chain is still pending", async () => {
    let resolveSeek: () => void = () => {};
    mockSeekTo.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          resolveSeek = resolve;
        })
    );

    const { result } = await renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });

    await act(() => {
      result.current.play(); // starts a chain; seekTo's promise hasn't resolved yet
    });
    expect(mockSeekTo).toHaveBeenCalledTimes(1);

    await act(() => {
      result.current.play(); // arrives mid-chain — dropped, not queued
    });
    expect(mockSeekTo).toHaveBeenCalledTimes(1);
    expect(mockPlay).not.toHaveBeenCalled();

    await act(async () => {
      resolveSeek();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("a play() call after the previous chain has settled is not dropped", async () => {
    mockSeekTo.mockReset(); // undo the pending-promise implementation from the test above
    const { result } = await renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });

    await act(async () => {
      result.current.play();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockSeekTo).toHaveBeenCalledTimes(1);

    await act(() => {
      result.current.play();
    });
    expect(mockSeekTo).toHaveBeenCalledTimes(2);
    expect(mockPlay).toHaveBeenCalledTimes(2);
  });
});
