/**
 * #3770, #3582: Blackjack's new cues (the mixed split's chime, the milestone and comeback cues, the
 * all-in) play their own files through the same `useSound` as every other Blackjack sound, so the
 * mute setting silences them; and only a win flashes the felt (a mixed split does not).
 */
import { act, renderHook } from "@testing-library/react-native";
import React from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

import { SoundProvider } from "../../../game/_shared/SoundContext";
import { BLACKJACK_SOUNDS } from "../../../game/blackjack/sounds";
import type { SoundCue } from "../blackjackMotion";
import { useBlackjackCues } from "../useBlackjackCues";

/** The registry source of each player that played. */
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

const NEW: readonly [SoundCue, string][] = [
  ["mixed", "blackjack.mixed"],
  ["milestone", "blackjack.milestone"],
  ["comeback", "blackjack.comeback"],
  ["allIn", "blackjack.allIn"],
];

async function mount(muted: boolean) {
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(muted ? "true" : null);
  const onWin = jest.fn();
  const onBust = jest.fn();
  const hook = await renderHook(() => useBlackjackCues({ onWin, onBust }), { wrapper });
  await act(async () => {
    await Promise.resolve();
  });
  return { play: hook.result.current, onWin, onBust };
}

async function playCue(play: (cue: SoundCue, skipped: boolean) => void, cue: SoundCue) {
  await act(async () => {
    play(cue, false);
    await Promise.resolve();
  });
}

beforeEach(() => {
  plays.length = 0;
  jest.clearAllMocks();
});

describe("Blackjack's new cues (#3770, #3582)", () => {
  it.each(NEW)("%s plays its own file (%s)", async (cue, key) => {
    const { play } = await mount(false);
    await playCue(play, cue);
    expect(BLACKJACK_SOUNDS[key]).toBeDefined();
    expect(plays).toEqual([BLACKJACK_SOUNDS[key]]);
  });

  it.each(NEW)("%s is silent when muted, like every other sound", async (cue) => {
    const { play } = await mount(true);
    await playCue(play, cue);
    await playCue(play, "win");
    expect(plays).toEqual([]);
  });

  it("a mixed split's chime does not flash the felt; a win does", async () => {
    const { play, onWin, onBust } = await mount(false);
    for (const [cue] of NEW) await playCue(play, cue);
    expect(onWin).not.toHaveBeenCalled();
    expect(onBust).not.toHaveBeenCalled();
    await playCue(play, "win");
    expect(onWin).toHaveBeenCalledTimes(1);
  });
});
