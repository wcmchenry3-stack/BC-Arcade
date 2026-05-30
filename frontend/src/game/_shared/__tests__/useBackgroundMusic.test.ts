import { renderHook, act } from "@testing-library/react-native";
import React from "react";
import { SoundProvider } from "../SoundContext";
import { useBackgroundMusic } from "../useBackgroundMusic";

const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockSeekTo = jest.fn();
const mockRemove = jest.fn();

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => ({
    play: mockPlay,
    pause: mockPause,
    seekTo: mockSeekTo,
    remove: mockRemove,
    set loop(_: boolean) {},
    set volume(_: number) {},
  })),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(SoundProvider, null, children);
}

const TEST_KEY = "test.bg1";
const TEST_REGISTRY: Record<string, number> = { [TEST_KEY]: 1 as unknown as number };

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useBackgroundMusic — unmount cleanup", () => {
  it("calls pause() before remove() on unmount while music is active", () => {
    const callOrder: string[] = [];
    mockPause.mockImplementation(() => callOrder.push("pause"));
    mockRemove.mockImplementation(() => callOrder.push("remove"));

    const { unmount } = renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), {
      wrapper,
    });
    unmount();

    expect(callOrder).toEqual(["pause", "remove"]);
  });

  it("calls pause() before remove() on unmount even when active is false", () => {
    const callOrder: string[] = [];
    mockPause.mockImplementation(() => callOrder.push("pause"));
    mockRemove.mockImplementation(() => callOrder.push("remove"));

    const { rerender, unmount } = renderHook(
      ({ active }: { active: boolean }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active),
      { wrapper, initialProps: { active: true } }
    );
    act(() => {
      rerender({ active: false });
    });
    unmount();

    expect(callOrder).toEqual(["pause", "pause", "remove"]);
  });
});

describe("useBackgroundMusic — active flag", () => {
  it("plays on mount when active is true", () => {
    renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), { wrapper });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("pauses when active transitions to false", () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active),
      { wrapper, initialProps: { active: true } }
    );
    act(() => {
      rerender({ active: false });
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
  });

  it("does not start playback when active is false on mount", () => {
    renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, false), { wrapper });
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("starts a new session after game-over then new-game (false→true)", () => {
    const { rerender } = renderHook(
      ({ active }: { active: boolean }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active),
      { wrapper, initialProps: { active: true } }
    );
    // First game: music playing
    expect(mockPlay).toHaveBeenCalled();
    jest.clearAllMocks();

    // Game over
    act(() => {
      rerender({ active: false });
    });
    expect(mockPause).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();

    // New game — must pick and play a new track
    act(() => {
      rerender({ active: true });
    });
    expect(mockPlay).toHaveBeenCalled();
  });
});

describe("useBackgroundMusic — empty / missing keys", () => {
  it("does not crash and does not play when keys array is empty", () => {
    renderHook(() => useBackgroundMusic([], TEST_REGISTRY, true), { wrapper });
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe("useBackgroundMusic — newGameTick", () => {
  it("starts a new session when newGameTick increments while active", () => {
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, tick),
      { wrapper, initialProps: { tick: 0 } }
    );
    // Mount: [newGameTick] skips (0), [active] starts session
    expect(mockPlay).toHaveBeenCalled();
    jest.clearAllMocks();

    // New game tick — should pick and play a new track
    act(() => {
      rerender({ tick: 1 });
    });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("starts a new session after game-over when both active and newGameTick change", () => {
    const { rerender } = renderHook(
      ({ active, tick }: { active: boolean; tick: number }) =>
        useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active, tick),
      { wrapper, initialProps: { active: true, tick: 0 } }
    );
    expect(mockPlay).toHaveBeenCalled();
    jest.clearAllMocks();

    // Game over
    act(() => {
      rerender({ active: false, tick: 0 });
    });
    expect(mockPause).toHaveBeenCalled();
    jest.clearAllMocks();

    // New game: both active true and tick increments (as StarSwarmScreen does)
    act(() => {
      rerender({ active: true, tick: 1 });
    });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("starts a new session from newGameTick even when active stays true (new game from pause)", () => {
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, tick),
      { wrapper, initialProps: { tick: 1 } }
    );
    // Treat tick=1 as initial (active already true going into the picker)
    jest.clearAllMocks();

    // New game tick, active stays true throughout
    act(() => {
      rerender({ tick: 2 });
    });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("does not play when newGameTick increments but active is false", () => {
    const { rerender } = renderHook(
      ({ tick }: { tick: number }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, false, tick),
      { wrapper, initialProps: { tick: 0 } }
    );
    expect(mockPlay).not.toHaveBeenCalled();
    jest.clearAllMocks();

    act(() => {
      rerender({ tick: 1 });
    });
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
