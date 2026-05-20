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
  it("play() is a no-op when key has no entry in registry", () => {
    const { result } = renderHook(() => useSound("unknown.key", EMPTY_REGISTRY), { wrapper });
    act(() => {
      result.current.play();
    });
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe("useSound — registered key", () => {
  it("play() calls seekTo(0) then play() on the audio player", () => {
    const { result } = renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });
    act(() => {
      result.current.play();
    });
    expect(mockSeekTo).toHaveBeenCalledWith(0);
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("play() is a no-op when muted", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("true");

    const { result } = renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });
    // Wait for AsyncStorage to resolve
    await act(async () => {});
    act(() => {
      result.current.play();
    });
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("returns a stable play reference across re-renders", () => {
    const { result, rerender } = renderHook(() => useSound("test.beep", TEST_REGISTRY), {
      wrapper,
    });
    const first = result.current.play;
    rerender({});
    expect(result.current.play).toBe(first);
  });

  it("calls remove() on the player when unmounted", () => {
    const { unmount } = renderHook(() => useSound("test.beep", TEST_REGISTRY), { wrapper });
    unmount();
    expect(mockRemove).toHaveBeenCalledTimes(1);
  });
});
