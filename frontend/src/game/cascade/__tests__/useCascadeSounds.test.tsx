/**
 * #3702: Cascade's sound players. The active piece set's files on the shared pool (8 at mount, the
 * rest on first play or pre-warmed when likely), switched with the piece set, released on
 * unmount, silent while muted (sounds already waiting included), the end sounds stopped by a new
 * game, and the win started later in under Reduce Motion.
 */
import { act, renderHook } from "@testing-library/react-native";
import { CHAIN_WARM_DELAY_MS, useCascadeSounds } from "../useCascadeSounds";
import { CASCADE_SOUND_NAMES, CHAIN_WARM_SOUNDS, LAZY_CASCADE_SOUNDS } from "../sounds";
import { CALM_WIN_OFFSET_S } from "../soundPacer";

// Jest maps every .ogg to one stub, so give each set's files distinct ids: fruits 100+, cosmos 200+.
jest.mock("../sounds", () => {
  const actual = jest.requireActual("../sounds");
  const ids = (base: number) =>
    Object.fromEntries((actual.CASCADE_SOUND_NAMES as string[]).map((name, i) => [name, base + i]));
  return { ...actual, CASCADE_SOUNDS: { fruits: ids(100), cosmos: ids(200) } };
});

interface FakeHold {
  source: number;
  lazy: boolean;
  plays: [number, number][];
  stops: number;
  released: boolean;
}
const mockHolds: FakeHold[] = [];
jest.mock("../../_shared/soundPool", () => ({
  acquireSound: (source: number, _volume: number, lazy: boolean) => {
    const h: FakeHold = { source, lazy, plays: [], stops: 0, released: false };
    mockHolds.push(h);
    return {
      play: (v: number, from = 0) => {
        h.plays.push([v, from]);
        return true;
      },
      stop: () => {
        h.stops++;
      },
      setVolume: () => {},
      release: () => {
        h.released = true;
      },
    };
  },
}));

let mockMuted = false;
jest.mock("../../_shared/SoundContext", () => ({
  useSoundSettings: () => ({ muted: mockMuted }),
}));

const idOf = (name: string, base = 100) => base + CASCADE_SOUND_NAMES.indexOf(name as never);
const nameOf = (source: number) => CASCADE_SOUND_NAMES[source % 100]!;
const live = () => mockHolds.filter((h) => !h.released);
const played = () => mockHolds.flatMap((h) => h.plays.map(() => nameOf(h.source)));
const holdOf = (name: string, base = 100) => live().find((h) => h.source === idOf(name, base));

type Props = { id: string; rm: boolean; nearWin: boolean };
const mount = (props: Partial<Props> = {}) =>
  renderHook((p: Props) => useCascadeSounds(p.id, p.rm, p.nearWin), {
    initialProps: { id: "fruits", rm: false, nearWin: false, ...props },
  });

beforeEach(() => {
  jest.useFakeTimers();
  mockHolds.length = 0;
  mockMuted = false;
});
afterEach(() => jest.useRealTimers());

it("takes 8 players at mount (the sounds of every turn) and the rest on their first play", async () => {
  const { result } = await mount();
  expect(CASCADE_SOUND_NAMES.length - LAZY_CASCADE_SOUNDS.size).toBe(8);
  expect(live()).toHaveLength(8);
  expect(live().every((h) => h.source < 200 && !h.lazy)).toBe(true);
  await act(async () => {
    result.current.merge(7, 1);
    jest.advanceTimersByTime(0);
  });
  expect(live()).toHaveLength(9);
  expect(played()).toEqual(["merge-t7"]);
  expect(mockHolds.at(-1)!.lazy).toBe(true);
});

it("pre-warms the win and merge-t11 once a tier-10 piece is on the board, and danger and game over when the count runs", async () => {
  const { result, rerender } = await mount();
  expect(holdOf("win")).toBeUndefined();
  expect(holdOf("merge-t11")).toBeUndefined();
  await rerender({ id: "fruits", rm: false, nearWin: true });
  expect(holdOf("win")).toBeDefined();
  expect(holdOf("merge-t11")).toBeDefined();
  expect(holdOf("game-over")).toBeUndefined();
  await act(async () => {
    result.current.danger(0.2, false);
    jest.advanceTimersByTime(0);
  });
  expect(holdOf("game-over")).toBeDefined();
  expect(holdOf("danger")).toBeDefined();
  expect(played()).toEqual([]); // warmed, not played
});

it("plays the Cosmos set for the Cosmos pieces, and a set switch swaps the players", async () => {
  const { result, rerender } = await mount();
  await rerender({ id: "cosmos", rm: false, nearWin: false });
  expect(live().every((h) => h.source >= 200)).toBe(true);
  expect(mockHolds.filter((h) => h.source < 200).every((h) => h.released)).toBe(true);
  await act(async () => {
    result.current.merge(3, 1);
    jest.advanceTimersByTime(0);
  });
  expect(live().find((h) => h.plays.length)?.source).toBe(idOf("merge-t3", 200));
});

it("is silent while muted, including sounds already waiting when mute goes on", async () => {
  const { result, rerender } = await mount();
  await act(async () => {
    result.current.merge(1, 1);
    result.current.merge(2, 2);
    result.current.merge(3, 3); // waits 80 ms for its chain step
    jest.advanceTimersByTime(0);
  });
  mockMuted = true;
  await rerender({ id: "fruits", rm: false, nearWin: false });
  await act(async () => {
    jest.advanceTimersByTime(500);
    result.current.drop();
    result.current.gameOver();
    jest.advanceTimersByTime(500);
  });
  expect(played()).toEqual(["merge-t1", "merge-t2", "chain-1"]);
});

it("the win plays merge-t11 with it, from the start of its own file (#3966)", async () => {
  const { result, rerender } = await mount();
  await rerender({ id: "fruits", rm: true, nearWin: false });
  await act(async () => {
    result.current.win();
    jest.advanceTimersByTime(0);
  });
  expect(holdOf("merge-t11")!.plays).toEqual([[1, 0]]);
  expect(holdOf("win")!.plays).toEqual([[1, CALM_WIN_OFFSET_S]]);
});

it("a new game stops the end sounds; under Reduce Motion the win starts 0.5 s in", async () => {
  const { result, rerender } = await mount();
  await act(async () => {
    result.current.win();
    jest.advanceTimersByTime(0);
  });
  await act(async () => result.current.reset());
  expect(holdOf("win")!.stops).toBe(1);
  await rerender({ id: "fruits", rm: true, nearWin: false });
  await act(async () => {
    result.current.win();
    jest.advanceTimersByTime(0);
  });
  expect(holdOf("win")!.plays).toEqual([
    [1, 0],
    [1, CALM_WIN_OFFSET_S],
  ]);
});

it("releases every player on unmount, and a sound still waiting never plays or creates one", async () => {
  const { result, unmount } = await mount();
  await act(async () => {
    result.current.merge(1, 1);
    result.current.merge(2, 2);
    result.current.merge(5, 3); // waits for its 80 ms step; merge-t5 is lazy
    jest.advanceTimersByTime(0);
  });
  const before = mockHolds.length;
  await unmount();
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(live()).toEqual([]);
  expect(mockHolds.length).toBe(before);
  expect(played()).toEqual(["merge-t1", "merge-t2", "chain-1"]);
});

// #4082: a chain's sounds get their players in idle time after the mount, so a later chain creates none.
it("creates the chain's players one per idle slice after CHAIN_WARM_DELAY_MS, and stops on unmount", async () => {
  const { unmount } = await mount();
  expect(live()).toHaveLength(8);
  await act(async () => {
    jest.advanceTimersByTime(CHAIN_WARM_DELAY_MS - 1);
  });
  expect(live()).toHaveLength(8);
  await act(async () => {
    jest.advanceTimersByTime(100); // the delay ends; then one player per idle slice
  });
  expect(live().map((h) => nameOf(h.source))).toEqual(
    expect.arrayContaining([...CHAIN_WARM_SOUNDS])
  );
  expect(live()).toHaveLength(8 + CHAIN_WARM_SOUNDS.length);
  expect(played()).toEqual([]); // warmed, not played
  expect(holdOf("danger")).toBeUndefined();
  await unmount();

  // Unmounted before the warm-up: it never runs.
  mockHolds.length = 0;
  const second = await mount();
  await second.unmount();
  await act(async () => {
    jest.advanceTimersByTime(CHAIN_WARM_DELAY_MS + 1000);
  });
  expect(mockHolds).toHaveLength(8);
});

// #4082 review: nothing to warm for while the game sound is muted; an unmute starts the warm-up.
it("muted at mount: no chain players are warmed; an unmute starts the warm-up", async () => {
  mockMuted = true;
  const { rerender } = await mount();
  await act(async () => {
    jest.advanceTimersByTime(CHAIN_WARM_DELAY_MS + 1000);
  });
  expect(live()).toHaveLength(8);
  mockMuted = false;
  await rerender({ id: "fruits", rm: false, nearWin: false });
  await act(async () => {
    jest.advanceTimersByTime(CHAIN_WARM_DELAY_MS - 1);
  });
  expect(live()).toHaveLength(8);
  await act(async () => {
    jest.advanceTimersByTime(1000);
  });
  expect(live()).toHaveLength(8 + CHAIN_WARM_SOUNDS.length);
  expect(played()).toEqual([]);
});

// #4082 review: the near-win warm follows the same rule: nothing while muted; an unmute creates it.
it("muted and nearWin: no win player is created; an unmute creates it", async () => {
  mockMuted = true;
  const { rerender } = await mount({ nearWin: true });
  expect(holdOf("win")).toBeUndefined();
  expect(holdOf("merge-t11")).toBeUndefined();
  mockMuted = false;
  await rerender({ id: "fruits", rm: false, nearWin: true });
  expect(holdOf("win")).toBeDefined();
  expect(holdOf("merge-t11")).toBeDefined();
  expect(played()).toEqual([]);
});
