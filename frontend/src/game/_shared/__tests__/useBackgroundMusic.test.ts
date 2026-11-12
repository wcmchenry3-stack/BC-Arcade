import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import { AppState, Platform } from "react-native";
import { SoundProvider, useSoundSettings } from "../SoundContext";
import { resetAudioSessionForTests, SESSION_RELEASE_DELAY_MS } from "../audioSession";
import {
  SELF_HEAL_DELAY_MS,
  SELF_HEAL_MAX_ATTEMPTS,
  useBackgroundMusic,
} from "../useBackgroundMusic";
import {
  BGM_FADE_IN_MS,
  BGM_FADE_IN_STEPS,
  BGM_SEEK_TIMEOUT_MS,
  type BackgroundMusicOptions,
} from "../useMusicVisit";

const mockPlay = jest.fn();
const mockPause = jest.fn();
const mockSeekTo = jest.fn();
const mockRemove = jest.fn();
const mockSetIsAudioActive = jest.fn((_active: boolean) => Promise.resolve());

type StatusLike = { isLoaded: boolean; playing: boolean; didJustFinish: boolean };
type MockPlayer = {
  isLoaded: boolean;
  playing: boolean;
  /** Seconds, as expo-audio reports it. */
  currentTime: number;
  /** Every value assigned to player.volume, in order. */
  volumes: number[];
  listenerRemove: jest.Mock;
  emit: (status: StatusLike) => void;
};
const mockPlayers: MockPlayer[] = [];

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn(() => {
    // Several listeners per player, like expo-audio's emitter (self-heal and the #3638 intro).
    const listeners: Set<(status: unknown) => void> = new Set();
    const listenerRemove = jest.fn();
    const volumes: number[] = [];
    const player = {
      play: mockPlay,
      pause: mockPause,
      seekTo: mockSeekTo,
      remove: mockRemove,
      isLoaded: false,
      playing: false,
      currentTime: 0,
      volumes,
      listenerRemove,
      addListener: jest.fn((_event: string, cb: (status: unknown) => void) => {
        listeners.add(cb);
        return {
          remove: () => {
            listeners.delete(cb);
            listenerRemove();
          },
        };
      }),
      emit: (status: unknown) => [...listeners].forEach((cb) => cb(status)),
      set loop(_: boolean) {},
      set volume(v: number) {
        volumes.push(v);
      },
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

// #3638: one track per visit with carry-over, starting points and a resume point.
describe("useBackgroundMusic — carry-over and starting points (#3638)", () => {
  const CUES = [0, 72_000, 155_000, 269_000, 326_000] as const;
  const RESUME_KEY = "bgm.resume.test";
  const OPTIONS: BackgroundMusicOptions = { cuesMs: CUES, resumeKey: RESUME_KEY, volume: 0.57 };
  const LOADED = { isLoaded: true, playing: false, didJustFinish: false };
  const storage = jest.requireMock("@react-native-async-storage/async-storage") as {
    getItem: jest.Mock;
    setItem: jest.Mock;
  };
  const { createAudioPlayer } = jest.requireMock("expo-audio") as {
    createAudioPlayer: jest.Mock;
  };

  type Props = { active: boolean; tick: number; paused: boolean };

  // Resolves the resume-point read with `saved` (other keys, e.g. the mute setting: null).
  function savedCue(saved: string | null | Error) {
    storage.getItem.mockImplementation((key: string) => {
      if (key !== RESUME_KEY) return Promise.resolve(null);
      return saved instanceof Error ? Promise.reject(saved) : Promise.resolve(saved);
    });
  }

  const resumeWrites = () =>
    storage.setItem.mock.calls.filter(([key]: [string]) => key === RESUME_KEY);

  // Lets pending promise callbacks (storage read, seek) run.
  const flush = () =>
    act(async () => {
      for (let i = 0; i < 5; i++) await Promise.resolve();
    });

  async function mount(
    initialProps: Props = { active: true, tick: 0, paused: false },
    options: BackgroundMusicOptions | undefined = OPTIONS
  ) {
    const hook = await renderHook(
      ({ active, tick, paused }: Props) => {
        useBackgroundMusic([TEST_KEY], TEST_REGISTRY, active, tick, paused, options);
        return useSoundSettings();
      },
      { wrapper, initialProps }
    );
    await flush();
    return { ...hook, player: mockPlayers[mockPlayers.length - 1] as MockPlayer };
  }

  // Mount, first load, fade done: the track is playing at full volume.
  async function mountPlaying(options: BackgroundMusicOptions = OPTIONS) {
    jest.useFakeTimers();
    const hook = await mount(undefined, options);
    hook.player.isLoaded = true;
    await act(() => hook.player.emit(LOADED));
    await flush();
    await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
    return hook;
  }

  beforeEach(() => savedCue(null));
  afterEach(() => {
    storage.getItem.mockReset();
    storage.getItem.mockResolvedValue(null);
    storage.setItem.mockReset();
    storage.setItem.mockResolvedValue(undefined);
    mockSeekTo.mockReset();
  });

  describe("carry-over within a visit", () => {
    it("a new game after game over resumes the same player at the same position", async () => {
      const { rerender, player } = await mountPlaying();
      expect(createAudioPlayer).toHaveBeenCalledTimes(1);
      player.currentTime = 95;
      jest.clearAllMocks();

      await rerender({ active: false, tick: 0, paused: false }); // game over
      expect(mockPause).toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();

      await rerender({ active: true, tick: 1, paused: false }); // play again
      expect(createAudioPlayer).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockSeekTo).not.toHaveBeenCalled();
      expect(mockPlay).toHaveBeenCalled();
      expect(player.currentTime).toBe(95);
    });

    it("an active false→true edge without a tick also resumes", async () => {
      const { rerender } = await mountPlaying();
      await rerender({ active: false, tick: 0, paused: false });
      jest.clearAllMocks();
      await rerender({ active: true, tick: 0, paused: false });
      expect(createAudioPlayer).not.toHaveBeenCalled();
      expect(mockSeekTo).not.toHaveBeenCalled();
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });

    it("a new game while active (tick only) keeps the track playing", async () => {
      const { rerender } = await mountPlaying();
      jest.clearAllMocks();
      await rerender({ active: true, tick: 1, paused: false });
      expect(createAudioPlayer).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockSeekTo).not.toHaveBeenCalled();
    });

    it("a new game from the pause screen resumes the same player", async () => {
      const { rerender } = await mountPlaying();
      await rerender({ active: true, tick: 0, paused: true });
      jest.clearAllMocks();
      await rerender({ active: true, tick: 1, paused: false });
      expect(createAudioPlayer).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
      expect(mockPlay).toHaveBeenCalled();
    });

    it("pause still holds and resumes the same track", async () => {
      const { rerender } = await mountPlaying();
      jest.clearAllMocks();
      await rerender({ active: true, tick: 0, paused: true });
      expect(mockPause).toHaveBeenCalledTimes(1);
      expect(mockPlay).not.toHaveBeenCalled();
      await rerender({ active: true, tick: 0, paused: false });
      expect(mockPlay).toHaveBeenCalledTimes(1);
      expect(createAudioPlayer).not.toHaveBeenCalled();
    });

    it("a new game while game over stays silent and keeps the player", async () => {
      const { rerender } = await mountPlaying();
      await rerender({ active: false, tick: 0, paused: false });
      jest.clearAllMocks();
      await rerender({ active: false, tick: 1, paused: false });
      expect(mockPlay).not.toHaveBeenCalled();
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });

  describe("visit start: seek and fade-in", () => {
    it("a first visit starts at 0:00 and fades in from 0 to the volume", async () => {
      jest.useFakeTimers();
      const { player } = await mount();
      expect(player.volumes).toEqual([0]); // created silent
      expect(mockPlay).toHaveBeenCalled(); // play() at once, as before (#2923)
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      expect(mockSeekTo).not.toHaveBeenCalled();

      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(player.volumes).toHaveLength(1 + BGM_FADE_IN_STEPS);
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
      for (let i = 1; i < player.volumes.length; i++) {
        expect(player.volumes[i]).toBeGreaterThan(player.volumes[i - 1] as number);
      }
    });

    it("the next visit seeks to the saved cue on the first load, once, then fades in", async () => {
      jest.useFakeTimers();
      savedCue("155000");
      const { player } = await mount();
      // Not before the player has loaded (see attachIntro).
      expect(mockSeekTo).not.toHaveBeenCalled();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(player.volumes).toEqual([0]); // no fade before the seek

      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      expect(mockSeekTo).toHaveBeenCalledTimes(1);
      expect(mockSeekTo).toHaveBeenCalledWith(155);

      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
      await act(() => player.emit(LOADED));
      await flush();
      expect(mockSeekTo).toHaveBeenCalledTimes(1);
    });

    it("seeks at once when the player is already loaded as the cue arrives", async () => {
      let resolve: (v: string) => void = () => {};
      storage.getItem.mockImplementation((key: string) =>
        key === RESUME_KEY ? new Promise((r) => (resolve = r)) : Promise.resolve(null)
      );
      const { player } = await mount();
      player.isLoaded = true;
      await act(async () => resolve("326000"));
      await flush();
      expect(mockSeekTo).toHaveBeenCalledWith(326);
    });

    it.each([["garbage"], ["-1"], ["99999"], ["72000.5"], ["500000"], [""], [null]])(
      "a saved value of %p starts at 0:00",
      async (saved) => {
        jest.useFakeTimers();
        savedCue(saved);
        const { player } = await mount();
        player.isLoaded = true;
        await act(() => player.emit(LOADED));
        await flush();
        expect(mockSeekTo).not.toHaveBeenCalled();
        await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
        expect(player.volumes.at(-1)).toBeCloseTo(0.57);
      }
    );

    it("a storage read error is swallowed and starts at 0:00", async () => {
      jest.useFakeTimers();
      savedCue(new Error("disk"));
      const { player } = await mount();
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      expect(mockSeekTo).not.toHaveBeenCalled();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
    });

    it("a failed seek still fades in", async () => {
      jest.useFakeTimers();
      savedCue("72000");
      mockSeekTo.mockRejectedValueOnce(new Error("seek"));
      const { player } = await mount();
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
    });

    it("mute during the fade-in stays silent", async () => {
      jest.useFakeTimers();
      const { player, result } = await mount();
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS / 2)); // part-way
      const stepsSoFar = player.volumes.length;
      mockPlay.mockClear();

      await act(() => result.current.setMuted(true));
      expect(mockPause).toHaveBeenCalled();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS * 2));
      expect(mockPlay).not.toHaveBeenCalled();
      // The fade stopped: one jump to the target (heard only after unmuting), no more steps.
      expect(player.volumes).toHaveLength(stepsSoFar + 1);
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
    });

    it("muted on arrival: no fade, the volume is set for after unmuting", async () => {
      jest.useFakeTimers();
      storage.getItem.mockImplementation((key: string) =>
        Promise.resolve(key === "settings.soundMuted" ? "true" : null)
      );
      const { player } = await mount();
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS * 2));
      expect(player.volumes).toEqual([0, 0.57]);
    });

    it("game over during the fade-in ends it at the target volume", async () => {
      jest.useFakeTimers();
      const { player, rerender } = await mount();
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS / 2));
      const stepsSoFar = player.volumes.length;
      await rerender({ active: false, tick: 0, paused: false });
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS * 2));
      expect(player.volumes).toHaveLength(stepsSoFar + 1);
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
    });

    it("the #2923 self-heal still re-issues play() for a stuck carry-over player", async () => {
      jest.useFakeTimers();
      const { player } = await mount();
      mockPlay.mockClear();
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS));
      expect(mockPlay).toHaveBeenCalledTimes(1);
    });
  });

  describe("resume point", () => {
    it("unmount writes the first cue after the position, once", async () => {
      const { player, unmount } = await mountPlaying();
      player.currentTime = 100; // 1:40 → 2:35
      await unmount();
      expect(resumeWrites()).toEqual([[RESUME_KEY, "155000"]]);
    });

    it("after the last cue it wraps to 0:00", async () => {
      const { player, unmount } = await mountPlaying();
      player.currentTime = 400;
      await unmount();
      expect(resumeWrites()).toEqual([[RESUME_KEY, "0"]]);
    });

    it("the position is read before the player is released", async () => {
      const { player, unmount } = await mountPlaying();
      player.currentTime = 10;
      mockRemove.mockImplementation(() => {
        player.currentTime = 0;
      });
      await unmount();
      expect(resumeWrites()).toEqual([[RESUME_KEY, "72000"]]);
    });

    describe("going to the background", () => {
      let handlers: ((state: string) => void)[];
      beforeEach(() => {
        handlers = [];
        jest.spyOn(AppState, "addEventListener").mockImplementation(((
          _type: string,
          cb: (state: string) => void
        ) => {
          handlers.push(cb);
          return { remove: jest.fn() };
        }) as unknown as typeof AppState.addEventListener);
      });
      const appState = (state: string) => act(() => handlers.forEach((h) => h(state)));

      it("writes once, and not again on the unmount of the same leave", async () => {
        const { player, unmount } = await mountPlaying();
        player.currentTime = 280;
        await appState("background");
        expect(resumeWrites()).toEqual([[RESUME_KEY, "326000"]]);
        await appState("background");
        await unmount();
        expect(resumeWrites()).toHaveLength(1);
      });

      // An iOS app-switcher swipe kills the app from inactive, without background or unmount.
      it("inactive is a leave: one write", async () => {
        const { player } = await mountPlaying();
        player.currentTime = 280;
        await appState("inactive");
        expect(resumeWrites()).toEqual([[RESUME_KEY, "326000"]]);
      });

      it("inactive then background is still one write", async () => {
        const { player, unmount } = await mountPlaying();
        player.currentTime = 280;
        await appState("inactive");
        await appState("background");
        await unmount();
        expect(resumeWrites()).toHaveLength(1);
      });

      it("inactive, back to active, then a leave again writes a second time", async () => {
        const { player } = await mountPlaying();
        player.currentTime = 10;
        await appState("inactive");
        await appState("active");
        player.currentTime = 160;
        await appState("inactive");
        expect(resumeWrites()).toEqual([
          [RESUME_KEY, "72000"],
          [RESUME_KEY, "269000"],
        ]);
      });

      it("no listener at all without a resumeKey", async () => {
        await mountPlaying({ cuesMs: CUES, volume: 0.57 });
        await renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), { wrapper });
        expect(AppState.addEventListener).not.toHaveBeenCalled();
      });

      it("a return to the app starts a new stay, whose leave writes again", async () => {
        const { player, unmount } = await mountPlaying();
        player.currentTime = 10;
        await appState("background");
        await appState("active");
        player.currentTime = 160;
        await unmount();
        expect(resumeWrites()).toEqual([
          [RESUME_KEY, "72000"],
          [RESUME_KEY, "269000"],
        ]);
      });
    });

    it("no write during play: game over, new games, pause, unpause", async () => {
      const { rerender, player, unmount } = await mountPlaying();
      player.currentTime = 30;
      await rerender({ active: false, tick: 0, paused: false });
      await rerender({ active: true, tick: 1, paused: false });
      await rerender({ active: true, tick: 1, paused: true });
      await rerender({ active: true, tick: 2, paused: false });
      await act(() => jest.advanceTimersByTime(60_000));
      expect(storage.setItem).not.toHaveBeenCalled();
      await unmount();
      expect(resumeWrites()).toHaveLength(1);
    });

    it("a storage write error is swallowed (rejected or thrown)", async () => {
      storage.setItem.mockRejectedValueOnce(new Error("full"));
      const first = await mountPlaying();
      await expect(first.unmount()).resolves.not.toThrow();
      await flush();

      storage.setItem.mockImplementationOnce(() => {
        throw new Error("gone");
      });
      const second = await mountPlaying();
      await expect(second.unmount()).resolves.not.toThrow();
    });

    it("leaving before the visit's seek has landed keeps the previous resume point", async () => {
      savedCue("155000");
      const { unmount } = await mount();
      await unmount();
      expect(resumeWrites()).toHaveLength(0);
    });

    it("never writes without a resumeKey", async () => {
      const { player, unmount } = await mountPlaying({ cuesMs: CUES, volume: 0.57 });
      player.currentTime = 100;
      await unmount();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalledWith(RESUME_KEY);
    });
  });

  describe("review round 1 (#3638)", () => {
    it("a resumed player that reports loaded but not playing gets play() re-issued, within the self-heal limits", async () => {
      const { rerender, player } = await mountPlaying();
      // The first player was seen playing, so its original self-heal is spent.
      await act(() => player.emit({ isLoaded: true, playing: true, didJustFinish: false }));
      await rerender({ active: false, tick: 0, paused: false }); // game over
      mockPlay.mockClear();

      await rerender({ active: true, tick: 1, paused: false }); // play again
      // The resume itself ([newGameTick], then [active]'s continue path in the same commit).
      const resumeCalls = mockPlay.mock.calls.length;
      expect(resumeCalls).toBeGreaterThanOrEqual(1);
      await act(() => player.emit(LOADED)); // the resume play() was lost
      await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS));
      expect(mockPlay).toHaveBeenCalledTimes(resumeCalls + 1);
      await act(() => player.emit(LOADED)); // a later status must not re-arm a spent budget
      await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * (SELF_HEAL_MAX_ATTEMPTS + 5)));
      expect(mockPlay).toHaveBeenCalledTimes(resumeCalls + SELF_HEAL_MAX_ATTEMPTS);
    });

    it("an active false→true resume without a tick also re-arms the self-heal", async () => {
      const { rerender, player } = await mountPlaying();
      await act(() => player.emit({ isLoaded: true, playing: true, didJustFinish: false }));
      await rerender({ active: false, tick: 0, paused: false });
      mockPlay.mockClear();
      await rerender({ active: true, tick: 0, paused: false });
      await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS));
      expect(mockPlay).toHaveBeenCalledTimes(2); // the resume and one checked retry
    });

    it("a resume that takes is left alone", async () => {
      const { rerender, player } = await mountPlaying();
      await rerender({ active: false, tick: 0, paused: false });
      mockPlay.mockClear();
      await rerender({ active: true, tick: 1, paused: false });
      const resumeCalls = mockPlay.mock.calls.length;
      player.playing = true;
      await act(() => jest.advanceTimersByTime(SELF_HEAL_DELAY_MS * 5));
      expect(mockPlay).toHaveBeenCalledTimes(resumeCalls);
    });

    it("a 0:00 start waits for the loaded status before the fade (Codex, PR #3733)", async () => {
      jest.useFakeTimers();
      const { player } = await mount(); // first visit: no stored cue, so it starts at 0:00
      await flush();
      // Loading takes longer than the fade: nothing may fade in yet.
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS * 1.5));
      expect(player.volumes).toEqual([0]);
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(player.volumes).toHaveLength(1 + BGM_FADE_IN_STEPS); // the whole fade is heard
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
      expect(mockSeekTo).not.toHaveBeenCalled();
    });

    it("a 0:00 start with no loaded status still fades in after the timeout", async () => {
      jest.useFakeTimers();
      const { player } = await mount();
      await act(() => jest.advanceTimersByTime(BGM_SEEK_TIMEOUT_MS - 1));
      expect(player.volumes).toEqual([0]);
      await act(() => jest.advanceTimersByTime(1 + BGM_FADE_IN_MS));
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
    });

    it("no loaded status within the timeout: the seek is given up and the track fades in", async () => {
      jest.useFakeTimers();
      savedCue("155000");
      const { player } = await mount();
      await act(() => jest.advanceTimersByTime(BGM_SEEK_TIMEOUT_MS - 1));
      expect(player.volumes).toEqual([0]);
      await act(() => jest.advanceTimersByTime(1));
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(mockSeekTo).not.toHaveBeenCalled();
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
      // A late loaded status does not seek any more.
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      expect(mockSeekTo).not.toHaveBeenCalled();
    });

    it("after the seek timeout a live volume change applies again", async () => {
      jest.useFakeTimers();
      savedCue("155000");
      let volume = 0.57;
      const hook = await renderHook(
        () =>
          useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, 0, false, {
            cuesMs: CUES,
            resumeKey: RESUME_KEY,
            volume,
          }),
        { wrapper }
      );
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_SEEK_TIMEOUT_MS + BGM_FADE_IN_MS));
      volume = 0.7;
      await hook.rerender({});
      expect(mockPlayers[0]?.volumes.at(-1)).toBeCloseTo(0.7);
    });

    it("a storage read that resolves after unmount neither seeks nor sets the volume", async () => {
      jest.useFakeTimers();
      let resolve: (v: string) => void = () => {};
      storage.getItem.mockImplementation((key: string) =>
        key === RESUME_KEY ? new Promise((r) => (resolve = r)) : Promise.resolve(null)
      );
      const { player, unmount } = await mount();
      player.isLoaded = true;
      await unmount();
      const volumesAtUnmount = [...player.volumes];
      await act(async () => resolve("155000"));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_SEEK_TIMEOUT_MS + BGM_FADE_IN_MS));
      expect(mockSeekTo).not.toHaveBeenCalled();
      expect(player.volumes).toEqual(volumesAtUnmount);
    });

    async function midFade() {
      jest.useFakeTimers();
      const hook = await mount();
      hook.player.isLoaded = true;
      await act(() => hook.player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS / 2));
      return hook;
    }

    it("pause in the middle of the fade ends it at the target, silent", async () => {
      const { player, rerender } = await midFade();
      const stepsSoFar = player.volumes.length;
      mockPlay.mockClear();
      await rerender({ active: true, tick: 0, paused: true });
      expect(mockPause).toHaveBeenCalled();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS * 2));
      expect(player.volumes).toHaveLength(stepsSoFar + 1);
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
      expect(mockPlay).not.toHaveBeenCalled();
    });

    it("unmuting after a mid-fade mute plays at 0.57", async () => {
      const { player, result } = await midFade();
      await act(() => result.current.setMuted(true));
      mockPlay.mockClear();
      await act(() => result.current.setMuted(false));
      expect(mockPlay).toHaveBeenCalledTimes(1);
      expect(player.volumes.at(-1)).toBeCloseTo(0.57);
    });

    it("a live volume change in the middle of the fade: the fade lands on the new value", async () => {
      jest.useFakeTimers();
      let volume = 0.57;
      const hook = await renderHook(
        () =>
          useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, 0, false, {
            cuesMs: CUES,
            resumeKey: RESUME_KEY,
            volume,
          }),
        { wrapper }
      );
      await flush();
      const player = mockPlayers[0] as MockPlayer;
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS / 2));
      const midValue = player.volumes.at(-1) as number;
      expect(midValue).toBeLessThan(0.57);
      volume = 0.8;
      await hook.rerender({});
      // The intro still owns the volume: no jump to 0.8 mid-fade.
      expect(player.volumes.at(-1)).toBe(midValue);
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      expect(player.volumes.at(-1)).toBeCloseTo(0.8);
    });
  });

  describe("volume option", () => {
    it("is applied to the player; without it the default stays 0.2", async () => {
      await mount(undefined, { volume: 0.57 });
      expect(mockPlayers[0]?.volumes).toEqual([0.57]);
      await renderHook(() => useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true), { wrapper });
      expect(mockPlayers[1]?.volumes).toEqual([0.2]);
    });

    it("a live change reaches the playing track (the dev mixer)", async () => {
      jest.useFakeTimers();
      let volume = 0.57;
      const hook = await renderHook(
        ({ tick }: { tick: number }) =>
          useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, tick, false, {
            cuesMs: CUES,
            resumeKey: RESUME_KEY,
            volume,
          }),
        { wrapper, initialProps: { tick: 0 } }
      );
      const player = mockPlayers[0] as MockPlayer;
      player.isLoaded = true;
      await act(() => player.emit(LOADED));
      await flush();
      await act(() => jest.advanceTimersByTime(BGM_FADE_IN_MS));
      volume = 0.65;
      await hook.rerender({ tick: 0 });
      expect(player.volumes.at(-1)).toBeCloseTo(0.65);
    });

    it("a change while the visit waits for its seek does not unmute the wait", async () => {
      savedCue("72000");
      let volume = 0.57;
      const hook = await renderHook(
        () =>
          useBackgroundMusic([TEST_KEY], TEST_REGISTRY, true, 0, false, {
            cuesMs: CUES,
            resumeKey: RESUME_KEY,
            volume,
          }),
        { wrapper }
      );
      await flush();
      volume = 0.7;
      await hook.rerender({});
      expect(mockPlayers[0]?.volumes).toEqual([0]);
    });
  });

  describe("Mahjong regression: no options", () => {
    it("picks a random track per new game, never seeks, plays at 0.2, never touches the resume point", async () => {
      const registry: Record<string, number> = { a: 11, b: 22 } as unknown as Record<
        string,
        number
      >;
      const random = jest.spyOn(Math, "random").mockReturnValueOnce(0).mockReturnValueOnce(0.99);
      const { rerender, unmount } = await renderHook(
        ({ active, tick }: { active: boolean; tick: number }) =>
          useBackgroundMusic(["a", "b"], registry, active, tick),
        { wrapper, initialProps: { active: true, tick: 0 } }
      );
      await rerender({ active: false, tick: 0 });
      await rerender({ active: true, tick: 1 });
      expect(random).toHaveBeenCalledTimes(2);
      expect(createAudioPlayer.mock.calls.map((c) => c[0])).toEqual([11, 22]);
      expect(mockRemove).toHaveBeenCalledTimes(1); // the first track was freed
      expect(mockPlayers.map((p) => p.volumes)).toEqual([[0.2], [0.2]]);
      mockPlayers[1]!.isLoaded = true;
      await act(() => mockPlayers[1]!.emit(LOADED));
      await flush();
      await unmount();
      expect(mockSeekTo).not.toHaveBeenCalled();
      expect(storage.setItem).not.toHaveBeenCalled();
      expect(storage.getItem).not.toHaveBeenCalledWith(RESUME_KEY);
    });
  });
});
