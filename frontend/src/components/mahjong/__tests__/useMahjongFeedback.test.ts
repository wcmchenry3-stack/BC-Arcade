/**
 * useMahjongFeedback (#2981): each engine event gets its sound, and under full
 * motion its animation (flying pair, shuffle pulse, deadlock shake); Reduce
 * Motion keeps the sounds and drops the motion. Events fire once per array
 * (#3087): a copy of the state with the same array is no new event.
 */
import { act, renderHook } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

import { createGame } from "../../../game/mahjong/engine";
import { getLayout } from "../../../game/mahjong/layouts/registry";
import type { MahjongEvent, MahjongState, SlotTile } from "../../../game/mahjong/types";
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

/** `base` with `events` emitted, as an engine action leaves it: a new array each time. */
function withEvents(base: MahjongState, ...events: MahjongEvent[]): MahjongState {
  return { ...base, events };
}
const select = (): MahjongEvent => ({ type: "tileSelect" });
const match = (a: SlotTile, b: SlotTile): MahjongEvent => ({ type: "tileMatch", tiles: [a, b] });
const firstPair = () => match(game.tiles[0]!, game.tiles[1]!);
const shuffle = (): MahjongEvent => ({ type: "shuffle" });
const deadlock = (): MahjongEvent => ({ type: "deadlock" });
const cleared = (): MahjongEvent => ({ type: "boardCleared" });

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
  it("makes no sound for a state without events or a step to or from no board", async () => {
    const hook = await setup(false, null);
    await hook.rerender({ s: game, rm: false });
    // A restored game with a selection carries no events.
    await hook.rerender({ s: { ...game, selected: game.tiles[0]! }, rm: false });
    await hook.rerender({ s: null, rm: false });
    expect(soundsPlayed()).toEqual([]);
    expect(sequence).not.toHaveBeenCalled();
  });

  it("plays the select sound when a tile is selected", async () => {
    const hook = await setup(false);
    await hook.rerender({
      s: withEvents({ ...game, selected: game.tiles[0]! }, select()),
      rm: false,
    });
    expect(soundsPlayed()).toEqual(["playTileSelect"]);
  });

  it("plays the match sound, not the select sound, when a pair leaves the board", async () => {
    const hook = await setup(false);
    await hook.rerender({
      s: withEvents({ ...game, tiles: game.tiles.slice(2) }, firstPair()),
      rm: false,
    });
    expect(soundsPlayed()).toEqual(["playTileMatch"]);
  });

  it("fires each events array once: a copy with the same array replays nothing", async () => {
    const hook = await setup(true);
    const selected = withEvents({ ...game, selected: game.tiles[0]! }, select());
    await hook.rerender({ s: selected, rm: true });
    // A clock pause or resume spreads the state and keeps the array.
    await hook.rerender({ s: { ...selected, paused: true }, rm: true });
    await hook.rerender({ s: { ...selected, paused: false }, rm: true });
    expect(mockSounds.playTileSelect).toHaveBeenCalledTimes(1);
    // A second select is a new array.
    await hook.rerender({ s: withEvents(selected, select()), rm: true });
    expect(mockSounds.playTileSelect).toHaveBeenCalledTimes(2);
  });

  it("plays the shuffle, win and deadlock sounds on those events only", async () => {
    const hook = await setup(true);
    const shuffled = withEvents({ ...game, shufflesLeft: game.shufflesLeft - 1 }, shuffle());
    await hook.rerender({ s: shuffled, rm: true });
    expect(soundsPlayed()).toEqual(["playShuffle"]);

    const deadlocked = withEvents({ ...shuffled, isDeadlocked: true }, deadlock());
    await hook.rerender({ s: deadlocked, rm: true });
    expect(mockSounds.playDeadlock).toHaveBeenCalledTimes(1);
    // Still deadlocked: not a new deadlock.
    await hook.rerender({ s: { ...deadlocked }, rm: true });
    expect(mockSounds.playDeadlock).toHaveBeenCalledTimes(1);

    const won = withEvents({ ...shuffled, tiles: [], isComplete: true }, firstPair(), cleared());
    await hook.rerender({ s: won, rm: true });
    expect(mockSounds.playWin).toHaveBeenCalledTimes(1);
    await hook.rerender({ s: { ...won }, rm: true });
    expect(mockSounds.playWin).toHaveBeenCalledTimes(1);
  });

  it("plays the events of one action in order", async () => {
    const hook = await setup(true);
    const order: string[] = [];
    for (const [name, fn] of Object.entries(mockSounds)) {
      fn.mockImplementation(() => order.push(name));
    }
    await hook.rerender({
      s: withEvents({ ...game, shufflesLeft: 0, isDeadlocked: true }, firstPair(), deadlock()),
      rm: true,
    });
    expect(order).toEqual(["playTileMatch", "playDeadlock"]);
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
    await hook.rerender({
      s: withEvents({ ...game, tiles: game.tiles.slice(2) }, firstPair()),
      rm: false,
    });
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
    const shuffled = withEvents({ ...game, shufflesLeft: game.shufflesLeft - 1 }, shuffle());
    await hook.rerender({ s: shuffled, rm: false });
    expect(sequence).toHaveBeenCalledTimes(1);
    expect(sequence.mock.calls[0]).toHaveLength(2);

    await hook.rerender({
      s: withEvents({ ...shuffled, isDeadlocked: true }, deadlock()),
      rm: false,
    });
    expect(sequence).toHaveBeenCalledTimes(2);
    expect(sequence.mock.calls[1]).toHaveLength(7);
  });

  it("keeps the sounds but drops all motion under Reduce Motion", async () => {
    const hook = await setup(true);
    const matched = { ...game, tiles: game.tiles.slice(2) };
    await hook.rerender({ s: withEvents(matched, firstPair()), rm: true });
    const shuffled = withEvents({ ...matched, shufflesLeft: game.shufflesLeft - 1 }, shuffle());
    await hook.rerender({ s: shuffled, rm: true });
    await hook.rerender({
      s: withEvents({ ...shuffled, isDeadlocked: true }, deadlock()),
      rm: true,
    });

    expect(mockSounds.playTileMatch).toHaveBeenCalledTimes(1);
    expect(mockSounds.playShuffle).toHaveBeenCalledTimes(1);
    expect(mockSounds.playDeadlock).toHaveBeenCalledTimes(1);
    expect(hook.result.current.flyingPairs).toEqual([]);
    expect(sequence).not.toHaveBeenCalled();
  });
});
