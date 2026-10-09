import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import { AppState, Platform } from "react-native";
import { SoundProvider } from "../SoundContext";
import { resetAudioSessionForTests, SESSION_RELEASE_DELAY_MS } from "../audioSession";
import {
  SELF_HEAL_DELAY_MS,
  SELF_HEAL_MAX_ATTEMPTS,
  useBackgroundMusic,
} from "../useBackgroundMusic";

const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockSeekTo = jest.fn();
const mockRemove = jest.fn();
const mockSetIsAudioActive = jest.fn((_active: boolean) => Promise.resolve());

type StatusLike = { isLoaded: boolean; playing: boolean; didJustFinish: boolean };
type MockPlayer = {
  isLoaded: boolean;
  playing: boolean;
  listenerRemove: jest.Mock;
  emit: (status: StatusLike) => void;
};
const mockPlayers: MockPlayer[] = [];

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => {
    let listener: ((status: unknown) => void) | null = null;
    const listenerRemove = jest.fn();
    const player = {
      play: mockPlay,
      pause: mockPause,
      seekTo: mockSeekTo,
      remove: mockRemove,
      isLoaded: false,
      playing: false,
      listenerRemove,
      addListener: jest.fn((_event: string, cb: (status: unknown) => void) => {
        listener = cb;
        return { remove: listenerRemove };
      }),
      emit: (status: unknown) => listener?.(status),
      set loop(_: boolean) {},
      set volume(_: number) {},
    };
    mockPlayers.push(player);
    return player;
  }),
  setIsAudioActiveAsync: (active: boolean) => mockSetIsAudioActive(active),
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
  mockPlayers.length = 0;
  resetAudioSessionForTests();
});

afterEach(() => {
  mockPause.mockReset();
  mockRemove.mockReset();
  mockPlay.mockReset();
  jest.useRealTimers();
  jest.restoreAllMocks();
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

describe("useBackgroundMusic — paused", () => {
  type Props = { active: boolean; tick: number; paused: boolean };
  const render = (initialProps: Props) =>
    renderHook(
      ({ active, tick, paused }: Props) =>
        useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active, tick, paused),
      { wrapper, initialProps }
    );
  const { createAudioPlayer } = jest.requireMock("expo-audio") as {
    createAudioPlayer: jest.Mock;
  };

  it("pauses the track when paused, and resumes the same track on unpause", async () => {
    const { rerender } = await render({ active: true, tick: 0, paused: false });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    jest.clearAllMocks();

    await rerender({ active: true, tick: 0, paused: true });
    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockPlay).not.toHaveBeenCalled();

    await rerender({ active: true, tick: 0, paused: false });
    expect(mockPlay).toHaveBeenCalledTimes(1);
    expect(createAudioPlayer).not.toHaveBeenCalled(); // same track, not a new one
  });

  it("mounting paused (a restored run) loads a track but stays silent until unpaused", async () => {
    const { rerender } = await render({ active: true, tick: 0, paused: true });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlay).not.toHaveBeenCalled();

    await rerender({ active: true, tick: 0, paused: false });
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("a new game from the pause screen starts a fresh track", async () => {
    const { rerender } = await render({ active: true, tick: 1, paused: true });
    jest.clearAllMocks();

    await rerender({ active: true, tick: 2, paused: false });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlay).toHaveBeenCalled();
  });

  it("unpausing after game over does not play", async () => {
    const { rerender } = await render({ active: true, tick: 0, paused: true });
    await rerender({ active: false, tick: 0, paused: true });
    jest.clearAllMocks();

    await rerender({ active: false, tick: 0, paused: false });
    expect(mockPlay).not.toHaveBeenCalled();
  });
});

describe("useBackgroundMusic — audio session (#2923)", () => {
  const { createAudioPlayer } = jest.requireMock("expo-audio") as {
    createAudioPlayer: jest.Mock;
  };

  it("creates the BGM player with keepAudioSessionActive so SFX can't tear the session down", async () => {
    await renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), { wrapper });
    expect(createAudioPlayer).toHaveBeenCalledWith(TEST_REGISTRY[TEST_KEY], {
      keepAudioSessionActive: true,
    });
  });

  it("pauses the old player before removing it, before creating the next track", async () => {
    const { rerender } = await renderHook(
      ({ tick }: { tick: number }) => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, tick),
      { wrapper, initialProps: { tick: 0 } }
    );
    jest.clearAllMocks();

    await rerender({ tick: 1 });

    expect(mockPause).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    const pauseAt = mockPause.mock.invocationCallOrder[0];
    const removeAt = mockRemove.mock.invocationCallOrder[0];
    const createAt = createAudioPlayer.mock.invocationCallOrder[0];
    expect(pauseAt).toBeLessThan(removeAt);
    expect(removeAt).toBeLessThan(createAt);
    // The old player's status listener is detached with it.
    expect(mockPlayers[0].listenerRemove).toHaveBeenCalled();
  });

  it("deactivates the session on iOS once the screen unmounts", async () => {
    jest.useFakeTimers();
    jest.replaceProperty(Platform, "OS", "ios");
    const { unmount } = await renderHook(
      () => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true),
      { wrapper }
    );
    await unmount();
    expect(mockSetIsAudioActive).not.toHaveBeenCalled();

    await act(() => jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS));
    expect(mockSetIsAudioActive).toHaveBeenCalledWith(false);
  });

  it("keeps the session while another game screen still holds it", async () => {
    jest.useFakeTimers();
    jest.replaceProperty(Platform, "OS", "ios");
    const first = await renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), {
      wrapper,
    });
    await renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), { wrapper });
    await first.unmount();

    await act(() => jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS * 2));
    expect(mockSetIsAudioActive).not.toHaveBeenCalled();
  });

  it("never deactivates explicitly on Android (it would block later playback there)", async () => {
    jest.useFakeTimers();
    jest.replaceProperty(Platform, "OS", "android");
    const { unmount } = await renderHook(
      () => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true),
      { wrapper }
    );
    await unmount();
    await act(() => jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS * 2));
    expect(mockSetIsAudioActive).not.toHaveBeenCalled();
  });
});

describe("useBackgroundMusic — self-heal (#2923)", () => {
  type Props = { active: boolean; paused: boolean };
  const LOADED_NOT_PLAYING = { isLoaded: true, playing: false, didJustFinish: false };

  // Mounts with music meant to be playing; returns the player with its initial play() cleared.
  async function mountPlaying(initialProps: Props = { active: true, paused: false }) {
    jest.useFakeTimers();
    const hook = await renderHook(
      ({ active, paused }: Props) =>
        useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active, undefined, paused),
      { wrapper, initialProps }
    );
    mockPlay.mockClear();
    return { ...hook, player: mockPlayers[mockPlayers.length - 1] };
  }

  async function stuck(player: MockPlayer) {
    player.isLoaded = true;
    player.playing = false;
    await act(() => player.emit(LOADED_NOT_PLAYING));
  }

  it("re-issues play() when the track is loaded but not playing", async () => {
    const { player } = await mountPlaying();
    await stuck(player);
    expect(mockPlay).not.toHaveBeenCalled(); // waits before acting

    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS));
    expect(mockPlay).toHaveBeenCalledTimes(1);
  });

  it("does nothing once the player reaches playing on its own", async () => {
    const { player } = await mountPlaying();
    await stuck(player);
    player.playing = true;
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS));
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("gives up after SELF_HEAL_MAX_ATTEMPTS so it can't loop", async () => {
    const { player } = await mountPlaying();
    await stuck(player);
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * (SELF_HEAL_MAX_ATTEMPTS + 5)));
    await stuck(player); // a later status must not re-arm a spent budget
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 5));
    expect(mockPlay).toHaveBeenCalledTimes(SELF_HEAL_MAX_ATTEMPTS);
  });

  it("stays out of the way after the track has been seen playing (e.g. a later system pause)", async () => {
    const { player } = await mountPlaying();
    await act(() => player.emit({ isLoaded: true, playing: true, didJustFinish: false }));
    await stuck(player);
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 3));
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("ignores a finished status", async () => {
    const { player } = await mountPlaying();
    player.isLoaded = true;
    await act(() => player.emit({ isLoaded: true, playing: false, didJustFinish: true }));
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 3));
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("does not fight a user pause that lands before the check", async () => {
    const { player, rerender } = await mountPlaying();
    await stuck(player);
    await rerender({ active: true, paused: true });
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 3));
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("does not play after game over", async () => {
    const { player, rerender } = await mountPlaying();
    await stuck(player);
    await rerender({ active: false, paused: false });
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 3));
    expect(mockPlay).not.toHaveBeenCalled();
  });

  it("does not play while the app is backgrounded", async () => {
    const { player } = await mountPlaying();
    const original = Object.getOwnPropertyDescriptor(AppState, "currentState");
    Object.defineProperty(AppState, "currentState", { value: "background", configurable: true });
    try {
      await stuck(player);
      await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 3));
      expect(mockPlay).not.toHaveBeenCalled();
    } finally {
      if (original) Object.defineProperty(AppState, "currentState", original);
      else delete (AppState as { currentState?: unknown }).currentState;
    }
  });

  it("stops checking once the screen unmounts", async () => {
    const { player, unmount } = await mountPlaying();
    await stuck(player);
    await unmount();
    await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 3));
    expect(mockPlay).not.toHaveBeenCalled();
    expect(player.listenerRemove).toHaveBeenCalled();
  });
});
