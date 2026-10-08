/**
 * useMahjongFeedback (#2981): each state change gets its sound, and under full
 * motion its animation (flying pair, shuffle pulse, deadlock shake); Reduce
 * Motion keeps the sounds and drops the motion.
 */
import { act, renderHook } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

import { createGame } from "../../../game/mahjong/engine";
import { getLayout } from "../../../game/mahjong/layouts/registry";
import type { MahjongState } from "../../../game/mahjong/types";
import { useMahjongFeedback } from "../useMahjongFeedback";

const mockSounds = {
  playTileSelect: jest.fn(),
  playTileMatch: jest.fn(),
  playShuffle: jest.fn(),
  playWin: jest.fn(),
  playDeadlock: jest.fn(),
};
const mockAudioActive: boolean[] = [];
jest.mock("../../../game/mahjong/useMahjongAudio", () => ({
  useMahjongAudio: (active: boolean) => {
    mockAudioActive.push(active);
    return mockSounds;
  },
}));

const game = createGame(getLayout("turtle"), 3);

let sequence: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  mockAudioActive.length = 0;
  sequence = jest.spyOn(Reanimated, "withSequence");
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function setup(reduceMotion: boolean, initial: MahjongState | null = game) {
  return renderHook(
    ({ s, rm }: { s: MahjongState | null; rm: boolean }) => useMahjongFeedback(s, rm),
    { initialProps: { s: initial, rm: reduceMotion } }
  );
}

function soundsPlayed(): string[] {
  return Object.entries(mockSounds)
    .filter(([, fn]) => fn.mock.calls.length > 0)
    .map(([name]) => name);
}

describe("useMahjongFeedback — sounds", () => {
  it("makes no sound for the first state or a step to or from no board", async () => {
    const hook = await setup(false, null);
    await hook.rerender({ s: game, rm: false });
    await hook.rerender({ s: null, rm: false });
    expect(soundsPlayed()).toEqual([]);
    expect(sequence).not.toHaveBeenCalled();
  });

  it("plays the select sound when a tile is selected", async () => {
    const hook = await setup(false);
    await hook.rerender({ s: { ...game, selected: game.tiles[0]! }, rm: false });
    expect(soundsPlayed()).toEqual(["playTileSelect"]);
  });

  it("plays the match sound, not the select sound, when tiles leave the board", async () => {
    const hook = await setup(false);
    await hook.rerender({
      s: { ...game, tiles: game.tiles.slice(2), selected: game.tiles[3]! },
      rm: false,
    });
    expect(soundsPlayed()).toEqual(["playTileMatch"]);
  });

  it("plays the shuffle, win and deadlock sounds on those transitions only", async () => {
    const hook = await setup(true);
    const shuffled = { ...game, shufflesLeft: game.shufflesLeft - 1 };
    await hook.rerender({ s: shuffled, rm: true });
    expect(soundsPlayed()).toEqual(["playShuffle"]);

    const deadlocked = { ...shuffled, isDeadlocked: true };
    await hook.rerender({ s: deadlocked, rm: true });
    expect(mockSounds.playDeadlock).toHaveBeenCalledTimes(1);
    // Still deadlocked: not a new deadlock.
    await hook.rerender({ s: { ...deadlocked }, rm: true });
    expect(mockSounds.playDeadlock).toHaveBeenCalledTimes(1);

    const won = { ...shuffled, tiles: [], isComplete: true };
    await hook.rerender({ s: won, rm: true });
    expect(mockSounds.playWin).toHaveBeenCalledTimes(1);
    await hook.rerender({ s: { ...won }, rm: true });
    expect(mockSounds.playWin).toHaveBeenCalledTimes(1);
  });

  it("plays music only while the board is live", async () => {
    const hook = await setup(false, null);
    expect(mockAudioActive.at(-1)).toBe(false);
    await hook.rerender({ s: game, rm: false });
    expect(mockAudioActive.at(-1)).toBe(true);
    await hook.rerender({ s: { ...game, isDeadlocked: true }, rm: false });
    expect(mockAudioActive.at(-1)).toBe(false);
    await hook.rerender({ s: { ...game, isComplete: true }, rm: false });
    expect(mockAudioActive.at(-1)).toBe(false);
  });
});

describe("useMahjongFeedback — motion", () => {
  it("flies the matched pair, and drops it when dismissed", async () => {
    const hook = await setup(false);
    await hook.rerender({ s: { ...game, tiles: game.tiles.slice(2) }, rm: false });
    const pairs = hook.result.current.flyingPairs;
    expect(pairs).toHaveLength(1);
    expect(pairs[0]!.tile1).toBe(game.tiles[0]);
    expect(pairs[0]!.tile2).toBe(game.tiles[1]);

    await act(async () => {
      hook.result.current.dismissFlyingPair(pairs[0]!.id);
    });
    expect(hook.result.current.flyingPairs).toEqual([]);
  });

  it("pulses the board on a shuffle and shakes it on a deadlock", async () => {
    const hook = await setup(false);
    const shuffled = { ...game, shufflesLeft: game.shufflesLeft - 1 };
    await hook.rerender({ s: shuffled, rm: false });
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(sequence.mock.calls[0]).toHaveLength(2);

    await hook.rerender({ s: { ...shuffled, isDeadlocked: true }, rm: false });
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(sequence.mock.calls[1]).toHaveLength(7);
  });

  it("keeps the sounds but drops all motion under Reduce Motion", async () => {
    const hook = await setup(true);
    await hook.rerender({ s: { ...game, tiles: game.tiles.slice(2) }, rm: true });
    const shuffled = { ...game, tiles: game.tiles.slice(2), shufflesLeft: game.shufflesLeft - 1 };
    await hook.rerender({ s: shuffled, rm: true });
    await hook.rerender({ s: { ...shuffled, isDeadlocked: true }, rm: true });

    expect(mockSounds.playTileMatch).toHaveBeenCalledTimes(1);
    expect(mockSounds.playShuffle).toHaveBeenCalledTimes(1);
    expect(mockSounds.playDeadlock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.flyingPairs).toEqual([]);
    expect(sequence).not.toHaveBeenCalled();
  });
});
