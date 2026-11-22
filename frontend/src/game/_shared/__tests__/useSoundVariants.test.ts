import { renderHook, act } from "@testing-library/react-native";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createAudioPlayer } from "expo-audio";
import { SoundProvider } from "../SoundContext";
import { useSoundVariants } from "../useSoundVariants";

// One mock player per created source, so a test can see which variation played.
const plays: number[] = [];

jest.mock("expo-audio", () => ({
  createAudioPlayer: jest.fn((source: number) => ({
    play: jest.fn(() => {
      plays.push(source);
    }),
    seekTo: jest.fn(() => Promise.resolve()),
    pause: jest.fn(),
    remove: jest.fn(),
    volume: 1,
  })),
}));

jest.mock("@react-native-async-storage/async-storage", () => ({
  getItem: jest.fn().mockResolvedValue(null),
  setItem: jest.fn().mockResolvedValue(undefined),
}));

function wrapper({ children }: { children: React.ReactNode }) {
  return React.createElement(SoundProvider, null, children);
}

const REGISTRY = { "t.a": 11, "t.b": 22, "t.c": 33 } as Record<string, number>;
const KEYS = ["t.a", "t.b", "t.c"];

/** play() n times, letting each seek→play chain settle before the next call. */
async function playTimes(play: () => boolean, n: number) {
  for (let i = 0; i < n; i++) {
    await act(async () => {
      play();
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  plays.length = 0;
  jest.clearAllMocks();
});

describe("useSoundVariants (#3563)", () => {
  it("creates one player per registered variation", async () => {
    await renderHook(() => useSoundVariants(KEYS, REGISTRY), { wrapper });
    expect((createAudioPlayer as jest.Mock).mock.calls.map((c) => c[0])).toEqual([11, 22, 33]);
  });

  it("never plays the same variation twice in a row, and uses every variation", async () => {
    const { result } = await renderHook(() => useSoundVariants(KEYS, REGISTRY), { wrapper });
    await playTimes(result.current.play, 60);
    expect(plays).toHaveLength(60);
    for (let i = 1; i < plays.length; i++) expect(plays[i]).not.toBe(plays[i - 1]);
    expect(new Set(plays)).toEqual(new Set([11, 22, 33]));
  });

  it("picks among the other variations with the injected random source", async () => {
    // random() = 0 always takes the first remaining choice: a, then b (a excluded), then a ...
    const first = () => 0;
    const { result } = await renderHook(() => useSoundVariants(KEYS, REGISTRY, 1, first), {
      wrapper,
    });
    await playTimes(result.current.play, 4);
    expect(plays).toEqual([11, 22, 11, 22]);
  });

  it("skips keys with no registry entry, and repeats a single variation", async () => {
    const { result } = await renderHook(() => useSoundVariants(["t.a", "missing.key"], REGISTRY), {
      wrapper,
    });
    await playTimes(result.current.play, 3);
    expect(plays).toEqual([11, 11, 11]);
  });

  it("returns false and plays nothing when no key is registered", async () => {
    const { result } = await renderHook(() => useSoundVariants(["x", "y"], REGISTRY), { wrapper });
    let started = true;
    await act(async () => {
      started = result.current.play();
    });
    expect(started).toBe(false);
    expect(plays).toEqual([]);
  });

  it("plays nothing when muted", async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValueOnce("true");
    const { result } = await renderHook(() => useSoundVariants(KEYS, REGISTRY), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    await playTimes(result.current.play, 3);
    expect(plays).toEqual([]);
  });
});
