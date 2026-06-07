import { renderHook } from "@testing-library/react-native";
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
  it("calls pause() before remove() on unmount while music is active", async () => {
    const callOrder: string[] = [];
    mockPause.mockImplementation(() => callOrder.push("pause"));
    mockRemove.mockImplementation(() => callOrder.push("remove"));

    const { unmount } = await renderHook(
      () => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true),
      {
        wrapper,
      }
    );
    await unmount();

    expect(callOrder).toEqual(["pause", "remove"]);
  });

  it("calls pause() before remove() on unmount even when active is false", async () => {
    const callOrder: string[] = [];
    mockPause.mockImplementation(() => callOrder.push("pause"));
    mockRemove.mockImplementation(() => callOrder.push("remove"));

    const { rerender, unmount } = await renderHook(
      ({ active }: { active: boolean }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active),
      { wrapper, initialProps: { active: true } }
    );
    await rerender({ active: false });
    await unmount();

    expect(callOrder).toEqual(["pause", "pause", "remove"]);
  });
});

describe("useBackgroundMusic — active flag", () => {
  it("plays on mount when active is true", async () => {
    await renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), { wrapper });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("pauses when active transitions to false", async () => {
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active),
      { wrapper, initialProps: { active: true } }
    );
    await rerender({ active: false });
    expect(mockPause).toHaveBeenCalledTimes(1);
  });

  it("does not start playback when active is false on mount", async () => {
    await renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, false), { wrapper });
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("starts a new session after game-over then new-game (false→true)", async () => {
    const { rerender } = await renderHook(
      ({ active }: { active: boolean }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active),
      { wrapper, initialProps: { active: true } }
    );
    // First game: music playing
    expect(mockPlay).toHaveBeenCalled();
    jest.clearAllMocks();

    // Game over
    await rerender({ active: false });
    expect(mockPause).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();

    // New game — must pick and play a new track
    await rerender({ active: true });
    expect(mockPlay).toHaveBeenCalled();
  });
});

describe("useBackgroundMusic — empty / missing keys", () => {
  it("does not crash and does not play when keys array is empty", async () => {
    await renderHook(() => useBackgroundMusic([], TEST_REGISTRY, true), { wrapper });
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe("useBackgroundMusic — newGameTick", () => {
  it("starts a new session when newGameTick increments while active", async () => {
    const { rerender } = await renderHook(
      ({ tick }: { tick: number }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, tick),
      { wrapper, initialProps: { tick: 0 } }
    );
    // Mount: [newGameTick] skips (0), [active] starts session
    expect(mockPlay).toHaveBeenCalled();
    jest.clearAllMocks();

    // New game tick — should pick and play a new track
    await rerender({ tick: 1 });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("starts a new session after game-over when both active and newGameTick change", async () => {
    const { rerender } = await renderHook(
      ({ active, tick }: { active: boolean; tick: number }) =>
        useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active, tick),
      { wrapper, initialProps: { active: true, tick: 0 } }
    );
    expect(mockPlay).toHaveBeenCalled();
    jest.clearAllMocks();

    // Game over
    await rerender({ active: false, tick: 0 });
    expect(mockPause).toHaveBeenCalled();
    jest.clearAllMocks();

    // New game: both active true and tick increments (as StarSwarmScreen does)
    await rerender({ active: true, tick: 1 });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("starts a new session from newGameTick even when active stays true (new game from pause)", async () => {
    const { rerender } = await renderHook(
      ({ tick }: { tick: number }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, tick),
      { wrapper, initialProps: { tick: 1 } }
    );
    // Treat tick=1 as initial (active already true going into the picker)
    jest.clearAllMocks();

    // New game tick, active stays true throughout
    await rerender({ tick: 2 });
    expect(mockPlay).toHaveBeenCalled();
  });

  it("does not play when newGameTick increments but active is false", async () => {
    const { rerender } = await renderHook(
      ({ tick }: { tick: number }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, false, tick),
      { wrapper, initialProps: { tick: 0 } }
    );
    expect(mockPlay).not.toHaveBeenCalled();
    jest.clearAllMocks();

    await rerender({ tick: 1 });
    expect(mockPlay).not.toHaveBeenCalled();
  });
});
