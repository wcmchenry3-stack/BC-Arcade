import { renderHook, act } from "@testing-library/react-native";
import React from "react";
import { createAudioPlayer, setIsAudioActiveAsync } from "expo-audio";
import { Platform } from "react-native";
import { SoundProvider } from "../SoundContext";
import { LAZY_SOUND, useSound } from "../useSound";
import { MAX_SOUND_VARIANTS, useSoundVariants } from "../useSoundVariants";
import { useLoopSound } from "../useLoopSound";
import { useRunSound } from "../useRunSound";
import { resetAudioSessionForTests, SESSION_RELEASE_DELAY_MS } from "../audioSession";
import { pooledPlayerCountForTests } from "../soundPool";
import * as fs from "fs";
import * as path from "path";
import {
  SOLITAIRE_AUTO_COMPLETE,
  SOLITAIRE_CARD_FAN,
  SOLITAIRE_CARD_FLIP,
  SOLITAIRE_CARD_PLACE,
} from "../../solitaire/sounds";
import { FREECELL_AUTO_COMPLETE, FREECELL_CARD_PLACE } from "../../freecell/sounds";
import { HEARTS_CARD_PLAY, HEARTS_TRICK_WON } from "../../hearts/sounds";

// Jest maps every .ogg to one stub module, so the real registries would collapse to a single
// asset. Rebuild each registry from its source file instead: one distinct number per asset file
// name, shared across screens exactly as the real files are (card-place-1.ogg is one asset).
const assetIds = new Map<string, number>();
function realRegistry(game: string): Record<string, number> {
  const src = fs.readFileSync(path.join(__dirname, `../../${game}/sounds.ts`), "utf8");
  const registry: Record<string, number> = {};
  for (const m of src.matchAll(/"([\w.]+)":\s*require\("[^"]*\/([\w-]+\.ogg)"\)/g)) {
    if (!assetIds.has(m[2]!)) assetIds.set(m[2]!, 1000 + assetIds.size);
    registry[m[1]!] = assetIds.get(m[2]!)!;
  }
  return registry;
}
const SOLITAIRE_SOUNDS = realRegistry("solitaire");
const FREECELL_SOUNDS = realRegistry("freecell");
const HEARTS_SOUNDS = realRegistry("hearts");

// One mock player per createAudioPlayer call, so a test can see which were created, played and
// removed.
interface MockPlayer {
  source: number;
  play: jest.Mock;
  seekTo: jest.Mock;
  pause: jest.Mock;
  remove: jest.Mock;
  volume: number;
  loop: boolean;
}
const mockPlayers: MockPlayer[] = [];

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn((source: number) => {
    const p = {
      source,
      play: jest.fn(() => Promise.resolve()),
      seekTo: jest.fn(() => Promise.resolve()),
      pause: jest.fn(),
      remove: jest.fn(),
      volume: 1,
      loop: false,
    };
    mockPlayers.push(p);
    return p;
  }),
  setIsAudioActiveAsync: jest.fn(() => Promise.resolve()),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(SoundProvider, null, children);
}

const REG: Record<string, number> = { a: 1, b: 2, c: 3, a2: 1 };
const created = () => (createAudioPlayer as jest.Mock).mock.calls.map((c) => c[0] as number);

beforeEach(() => {
  mockPlayers.length = 0;
  jest.clearAllMocks();
  resetAudioSessionForTests();
});

describe("useSound — lazy players (#3604)", () => {
  it("does not create the player on mount; creates it on the first play; reuses it after", async () => {
    const { result } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), { wrapper });
    expect(createAudioPlayer).not.toHaveBeenCalled();
    expect(pooledPlayerCountForTests()).toBe(0);

    let started = false;
    await act(async () => {
      started = result.current.play();
      await Promise.resolve();
    });
    expect(started).toBe(true);
    expect(created()).toEqual([1]);
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(1);

    await act(async () => {
      result.current.play();
      await Promise.resolve();
    });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(2);
  });

  it("the default is eager: the player exists after mount, before any play", async () => {
    await renderHook(() => useSound("a", REG), { wrapper });
    expect(created()).toEqual([1]);
  });

  it("an eager sound's first play rewinds first; a lazy sound's first play skips the redundant seek", async () => {
    const eager = await renderHook(() => useSound("a", REG), { wrapper });
    await act(async () => {
      eager.result.current.play();
      await Promise.resolve();
    });
    expect(mockPlayers[0]!.seekTo).toHaveBeenCalledWith(0);

    const lazy = await renderHook(() => useSound("b", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      lazy.result.current.play();
      await Promise.resolve();
    });
    const lazyPlayer = mockPlayers.find((p) => p.source === 2)!;
    expect(lazyPlayer.seekTo).not.toHaveBeenCalled();
    expect(lazyPlayer.play).toHaveBeenCalledTimes(1);
    await act(async () => {
      lazy.result.current.play();
      await Promise.resolve();
    });
    expect(lazyPlayer.seekTo).toHaveBeenCalledWith(0); // later plays rewind as usual
  });

  it("plays in the same order as an eager sound: the lazy first play starts synchronously, no async creation step", async () => {
    const { result } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      result.current.play();
    });
    // player created and play() reached within the same tick that play() was called
    await act(async () => {});
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(1);
  });

  it("rapid repeated play() creates one player only", async () => {
    const { result } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      for (let i = 0; i < 10; i++) result.current.play();
      await Promise.resolve();
    });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });

  it("a muted lazy sound never creates its player", async () => {
    const AsyncStorage = jest.requireMock("@react-native-async-storage/async-storage") as {
      getItem: jest.Mock;
    };
    AsyncStorage.getItem.mockResolvedValueOnce("true");
    const { result } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {});
    await act(async () => {
      expect(result.current.play()).toBe(false);
    });
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it("an unregistered lazy key returns false and creates nothing", async () => {
    const { result } = await renderHook(() => useSound("nope", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      expect(result.current.play()).toBe(false);
    });
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it("removes a lazily created player on unmount (pause before remove)", async () => {
    const { result, unmount } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), {
      wrapper,
    });
    await act(async () => {
      result.current.play();
    });
    await unmount();
    expect(mockPlayers[0]!.remove).toHaveBeenCalledTimes(1);
    expect(mockPlayers[0]!.pause.mock.invocationCallOrder[0]).toBeLessThan(
      mockPlayers[0]!.remove.mock.invocationCallOrder[0]!
    );
    expect(pooledPlayerCountForTests()).toBe(0);
  });

  it("a never-played lazy sound has nothing to remove on unmount", async () => {
    const { unmount } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await unmount();
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it("a play() that outlives the unmount does not create a leaked player", async () => {
    const { result, unmount } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), {
      wrapper,
    });
    const play = result.current.play;
    await unmount();
    let started = true;
    await act(async () => {
      started = play();
    });
    expect(started).toBe(false);
    expect(createAudioPlayer).not.toHaveBeenCalled();
    expect(pooledPlayerCountForTests()).toBe(0);
  });

  it("unmounting while the first play's seek/play is pending does not play a removed player", async () => {
    // eager sound, so the seek is awaited
    const { result, unmount } = await renderHook(() => useSound("a", REG), { wrapper });
    let resolveSeek: () => void = () => {};
    mockPlayers[0]!.seekTo.mockImplementationOnce(
      () => new Promise<void>((r) => (resolveSeek = r))
    );
    await act(async () => {
      result.current.play();
    });
    await unmount();
    await act(async () => {
      resolveSeek();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(mockPlayers[0]!.play).not.toHaveBeenCalled();
  });

  it("stop() on a lazy sound that was never played is a no-op", async () => {
    const { result } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      result.current.stop();
    });
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it("a lazy player is created at the live volume", async () => {
    const { result, rerender } = await renderHook(
      ({ v }: { v: number }) => useSound("a", REG, v, LAZY_SOUND),
      { wrapper, initialProps: { v: 0.5 } }
    );
    await rerender({ v: 0.25 });
    await act(async () => {
      result.current.play();
    });
    expect(mockPlayers[0]!.volume).toBe(0.25);
  });
});

describe("useSound — shared players (#3604)", () => {
  it("two keys that resolve to the same asset share one player", async () => {
    await renderHook(
      () => {
        useSound("a", REG);
        useSound("a2", REG);
      },
      { wrapper }
    );
    expect(created()).toEqual([1]);
  });

  it("the shared player is removed only when its last user unmounts", async () => {
    const first = await renderHook(() => useSound("a", REG), { wrapper });
    const second = await renderHook(() => useSound("a2", REG), { wrapper });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    await first.unmount();
    expect(mockPlayers[0]!.remove).not.toHaveBeenCalled();
    await second.unmount();
    expect(mockPlayers[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it("an eager and a lazy key on one asset share the player; the lazy play does not create another", async () => {
    const { result } = await renderHook(
      () => ({ eager: useSound("a", REG), lazy: useSound("a2", REG, 1, LAZY_SOUND) }),
      { wrapper }
    );
    await act(async () => {
      result.current.lazy.play();
    });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
  });
});

describe("audio session retain counting (#3604)", () => {
  const originalOS = Platform.OS;
  beforeEach(() => {
    Platform.OS = "ios";
    jest.useFakeTimers();
  });
  afterEach(() => {
    Platform.OS = originalOS;
    jest.useRealTimers();
  });

  it("a never-played lazy sound does not hold the session; unmounting never deactivates it", async () => {
    const { unmount } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
    });
    // nothing was ever retained, so nothing is released
    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
  });

  it("a played lazy sound holds the session until unmount, then releases it once", async () => {
    const { result, unmount } = await renderHook(() => useSound("a", REG, 1, LAZY_SOUND), {
      wrapper,
    });
    await act(async () => {
      result.current.play();
    });
    await act(async () => {
      jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
    });
    expect(setIsAudioActiveAsync).not.toHaveBeenCalled(); // held while the player exists
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
    });
    expect(setIsAudioActiveAsync).toHaveBeenCalledTimes(1);
    expect(setIsAudioActiveAsync).toHaveBeenCalledWith(false);
  });

  it("a shared player holds one retain: the session stays active until the last user unmounts", async () => {
    const first = await renderHook(() => useSound("a", REG), { wrapper });
    const second = await renderHook(() => useSound("a2", REG), { wrapper });
    await first.unmount();
    await act(async () => {
      jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
    });
    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
    await second.unmount();
    await act(async () => {
      jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
    });
    expect(setIsAudioActiveAsync).toHaveBeenCalledTimes(1);
  });

  it("an eager sound still holds the session from mount", async () => {
    const eager = await renderHook(() => useSound("a", REG), { wrapper });
    const lazy = await renderHook(() => useSound("b", REG, 1, LAZY_SOUND), { wrapper });
    await lazy.unmount();
    await act(async () => {
      jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
    });
    expect(setIsAudioActiveAsync).not.toHaveBeenCalled();
    await eager.unmount();
  });
});

describe("useSoundVariants — computed once, sized from MAX_SOUND_VARIANTS (#3604)", () => {
  it("uses every variation up to MAX_SOUND_VARIANTS and ignores the rest", async () => {
    const registry: Record<string, number> = {};
    const keys: string[] = [];
    for (let i = 0; i < MAX_SOUND_VARIANTS + 2; i++) {
      registry[`k${i}`] = 100 + i;
      keys.push(`k${i}`);
    }
    const plays: number[] = [];
    const { result } = await renderHook(() => useSoundVariants(keys, registry), {
      wrapper,
    });
    // one player per slot, created at mount; the extra keys got none
    expect(created()).toEqual(keys.slice(0, MAX_SOUND_VARIANTS).map((_, i) => 100 + i));
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        result.current.play();
        await Promise.resolve();
      });
    }
    for (const p of mockPlayers)
      for (let n = 0; n < p.play.mock.calls.length; n++) plays.push(p.source);
    // every slot, up to the constant, was reached; none beyond it
    expect(new Set(plays)).toEqual(new Set(mockPlayers.map((p) => p.source)));
    expect(new Set(plays).size).toBe(MAX_SOUND_VARIANTS);
  });

  it("does not re-derive the usable variations on every play", async () => {
    // A registry whose lookups are counted: play() must not index it again.
    let lookups = 0;
    const registry = new Proxy({ a: 1, b: 2, c: 3 } as Record<string, number>, {
      get(target, prop) {
        lookups++;
        return target[prop as string];
      },
    });
    const keys = ["a", "b", "c"];
    const { result } = await renderHook(() => useSoundVariants(keys, registry), { wrapper });
    const afterMount = lookups;
    for (let i = 0; i < 5; i++) {
      await act(async () => {
        result.current.play();
        await Promise.resolve();
      });
    }
    expect(lookups).toBe(afterMount);
  });

  it("keeps a stable play across re-renders", async () => {
    const keys = ["a", "b", "c"];
    const { result, rerender } = await renderHook(() => useSoundVariants(keys, REG), { wrapper });
    const first = result.current.play;
    await rerender({});
    expect(result.current.play).toBe(first);
  });

  it("lazy variations: none created on mount, each created on its first pick", async () => {
    const keys = ["a", "b", "c"];
    const { result } = await renderHook(() => useSoundVariants(keys, REG, 1, () => 0, LAZY_SOUND), {
      wrapper,
    });
    expect(createAudioPlayer).not.toHaveBeenCalled();
    await act(async () => {
      result.current.play(); // random()=0 -> first choice: "a"
      await Promise.resolve();
    });
    expect(created()).toEqual([1]);
    await act(async () => {
      result.current.play(); // "a" excluded -> "b"
      await Promise.resolve();
    });
    expect(created()).toEqual([1, 2]);
  });
});

describe("useLoopSound — lazy (#3604)", () => {
  it("creates the looping player on the first start(), not at mount, and removes it on unmount", async () => {
    const { result, unmount } = await renderHook(() => useLoopSound("a", REG, 0.5, LAZY_SOUND), {
      wrapper,
    });
    expect(createAudioPlayer).not.toHaveBeenCalled();
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    expect(createAudioPlayer).toHaveBeenCalledTimes(1);
    expect(mockPlayers[0]!.loop).toBe(true);
    expect(mockPlayers[0]!.volume).toBe(0.5);
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(1);
    await unmount();
    expect(mockPlayers[0]!.remove).toHaveBeenCalledTimes(1);
  });

  it("the first start() of a lazy loop does not seek (a not-yet-ready item may never complete the seek) and does play", async () => {
    const { result } = await renderHook(() => useLoopSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    expect(mockPlayers[0]!.seekTo).not.toHaveBeenCalled();
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(1);
  });

  it("an eager loop still rewinds before its first play", async () => {
    const { result } = await renderHook(() => useLoopSound("a", REG, 1), { wrapper });
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    expect(mockPlayers[0]!.seekTo).toHaveBeenCalledWith(0);
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(1);
  });

  it("a seek that never completes on a later start() does not wedge the loop: stop() then start() retries", async () => {
    const { result } = await renderHook(() => useLoopSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.stop();
    });
    mockPlayers[0]!.seekTo.mockImplementationOnce(() => new Promise<void>(() => {})); // never settles
    await act(async () => {
      result.current.start(); // pending, play() not reached
    });
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(1);
    await act(async () => {
      result.current.stop();
    });
    await act(async () => {
      result.current.start();
      await Promise.resolve();
    });
    expect(mockPlayers[0]!.play).toHaveBeenCalledTimes(2);
  });

  it("a first start() whose play() fails can be retried", async () => {
    const { result } = await renderHook(() => useLoopSound("a", REG, 1, LAZY_SOUND), { wrapper });
    await act(async () => {
      result.current.start();
    });
    mockPlayers[0]!.play.mockImplementationOnce(() => Promise.reject(new Error("not ready")));
    await act(async () => {
      result.current.stop();
      result.current.start();
      await Promise.resolve();
      await Promise.resolve();
    });
    await act(async () => {
      result.current.start(); // idempotent only while it is really playing
      await Promise.resolve();
    });
    expect(mockPlayers[0]!.play.mock.calls.length).toBeGreaterThanOrEqual(3);
  });

  it("stop() before any start() creates nothing; a start() after unmount creates nothing", async () => {
    const { result, unmount } = await renderHook(() => useLoopSound("a", REG, 1, LAZY_SOUND), {
      wrapper,
    });
    await act(async () => {
      result.current.stop();
    });
    await unmount();
    await act(async () => {
      result.current.start();
    });
    expect(createAudioPlayer).not.toHaveBeenCalled();
  });

  it("releases the audio session only if the loop was ever started", async () => {
    const originalOS = Platform.OS;
    Platform.OS = "ios";
    jest.useFakeTimers();
    try {
      const idle = await renderHook(() => useLoopSound("a", REG, 1, LAZY_SOUND), { wrapper });
      await idle.unmount();
      await act(async () => {
        jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
      });
      expect(setIsAudioActiveAsync).not.toHaveBeenCalled();

      const used = await renderHook(() => useLoopSound("a", REG, 1, LAZY_SOUND), { wrapper });
      await act(async () => {
        used.result.current.start();
      });
      await used.unmount();
      await act(async () => {
        jest.advanceTimersByTime(SESSION_RELEASE_DELAY_MS + 1);
      });
      expect(setIsAudioActiveAsync).toHaveBeenCalledTimes(1);
    } finally {
      Platform.OS = originalOS;
      jest.useRealTimers();
    }
  });
});

// The sounds each card screen declares, as hooks, with the registries and key lists the screens
// use. Keep in step with SolitaireScreen / FreeCellScreen / HeartsScreen / useFreeCellMotion.
describe("mockPlayers created on mount by the card screens (#3604)", () => {
  function useSolitaireSounds() {
    useSoundVariants(SOLITAIRE_CARD_FLIP, SOLITAIRE_SOUNDS);
    useSoundVariants(SOLITAIRE_CARD_FAN, SOLITAIRE_SOUNDS, 1, Math.random, LAZY_SOUND);
    useSoundVariants(SOLITAIRE_CARD_PLACE, SOLITAIRE_SOUNDS);
    useSound("solitaire.invalidMove", SOLITAIRE_SOUNDS);
    useSound("solitaire.multiCardMove", SOLITAIRE_SOUNDS, 1, LAZY_SOUND);
    useSound("solitaire.gameWin", SOLITAIRE_SOUNDS, 1, LAZY_SOUND);
    useSound("solitaire.autoCompleteSettle", SOLITAIRE_SOUNDS, 1, LAZY_SOUND);
    useRunSound(false, false, SOLITAIRE_AUTO_COMPLETE, SOLITAIRE_SOUNDS);
  }
  function useFreeCellSounds() {
    useSoundVariants(FREECELL_CARD_PLACE, FREECELL_SOUNDS);
    useSound("freecell.supermove", FREECELL_SOUNDS, 1, LAZY_SOUND);
    useSound("freecell.noMoves", FREECELL_SOUNDS, 1, LAZY_SOUND);
    useSound("freecell.gameWin", FREECELL_SOUNDS, 1, LAZY_SOUND);
    useRunSound(false, false, FREECELL_AUTO_COMPLETE, FREECELL_SOUNDS);
  }
  function useHeartsSounds() {
    useSound("hearts.heartsBroken", HEARTS_SOUNDS, 1, LAZY_SOUND);
    useSound("hearts.moonShot", HEARTS_SOUNDS, 1, LAZY_SOUND);
    useSound("hearts.queenOfSpades", HEARTS_SOUNDS, 1, LAZY_SOUND);
    useSoundVariants(HEARTS_CARD_PLAY, HEARTS_SOUNDS);
    useSoundVariants(HEARTS_TRICK_WON, HEARTS_SOUNDS);
    useSound("hearts.gameWon", HEARTS_SOUNDS, 1, LAZY_SOUND);
    useSound("hearts.gameLost", HEARTS_SOUNDS, 1, LAZY_SOUND);
  }

  // Before #3604 every key was its own player: Solitaire 16, FreeCell 9, Hearts 11.
  it.each([
    ["Solitaire", useSolitaireSounds, 7],
    ["FreeCell", useFreeCellSounds, 3],
    ["Hearts", useHeartsSounds, 6],
  ] as const)("%s mounts only the frequent sounds' mockPlayers", async (_name, hooks, expected) => {
    await renderHook(hooks, { wrapper });
    expect(createAudioPlayer).toHaveBeenCalledTimes(expected);
    expect(pooledPlayerCountForTests()).toBe(expected);
  });
});
