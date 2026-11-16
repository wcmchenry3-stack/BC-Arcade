/**
 * #3702: Cascade's sound players. The active piece set's files on the shared pool (frequent ones
 * at mount, rare ones on first play), switched with the piece set, released on unmount, and
 * silent while muted.
 */
import { act, renderHook } from "@testing-library/react-native";
import { useCascadeSounds } from "../useCascadeSounds";
import { CASCADE_SOUND_NAMES, LAZY_CASCADE_SOUNDS } from "../sounds";

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
  plays: number[];
  released: boolean;
}
const mockHolds: FakeHold[] = [];
jest.mock("../../_shared/soundPool", () => ({
  acquireSound: (source: number, _volume: number, lazy: boolean) => {
    const h = { source, lazy, plays: [] as number[], released: false };
    mockHolds.push(h);
    return {
      play: (v: number) => {
        h.plays.push(v);
        return true;
      },
      stop: () => {},
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

const nameOf = (source: number) => CASCADE_SOUND_NAMES[source % 100]!;
const live = () => mockHolds.filter((h) => !h.released);
const played = () => mockHolds.flatMap((h) => h.plays.map(() => [h.source, nameOf(h.source)]));

beforeEach(() => {
  jest.useFakeTimers();
  mockHolds.length = 0;
  mockMuted = false;
});
afterEach(() => jest.useRealTimers());

it("takes the frequent sounds' players at mount and the rare ones on their first play", async () => {
  const { result } = await renderHook(() => useCascadeSounds("fruits"));
  const eager = CASCADE_SOUND_NAMES.length - LAZY_CASCADE_SOUNDS.size;
  expect(live()).toHaveLength(eager);
  expect(live().every((h) => h.source < 200 && !h.lazy)).toBe(true);
  await act(() => {
    result.current.win();
    jest.advanceTimersByTime(0);
  });
  expect(live()).toHaveLength(eager + 1);
  expect(played()).toEqual([[100 + CASCADE_SOUND_NAMES.indexOf("win"), "win"]]);
  expect(mockHolds.at(-1)!.lazy).toBe(true);
});

it("plays the Cosmos set for the Cosmos pieces, and a set switch swaps the players", async () => {
  const { result, rerender } = await renderHook(({ id }) => useCascadeSounds(id), {
    initialProps: { id: "fruits" },
  });
  await rerender({ id: "cosmos" });
  expect(live().every((h) => h.source >= 200)).toBe(true);
  expect(mockHolds.filter((h) => h.source < 200).every((h) => h.released)).toBe(true);
  await act(() => {
    result.current.merge(3, 1);
    jest.advanceTimersByTime(0);
  });
  expect(played()).toEqual([[200 + CASCADE_SOUND_NAMES.indexOf("merge-t3"), "merge-t3"]]);
});

it("is silent while the game sound is muted", async () => {
  mockMuted = true;
  const { result } = await renderHook(() => useCascadeSounds("fruits"));
  await act(() => {
    result.current.drop();
    result.current.land(7);
    result.current.gameOver();
    jest.advanceTimersByTime(1000);
  });
  expect(played()).toEqual([]);
});

it("releases every player on unmount, and a sound still waiting never plays or creates one", async () => {
  const { result, unmount } = await renderHook(() => useCascadeSounds("fruits"));
  await act(() => {
    result.current.merge(1, 1);
    result.current.merge(2, 2);
    result.current.merge(3, 3); // waits for its 80 ms step
    jest.advanceTimersByTime(0);
  });
  const before = mockHolds.length;
  await unmount();
  await act(() => {
    jest.advanceTimersByTime(1000);
  });
  expect(live()).toEqual([]);
  expect(mockHolds.length).toBe(before);
  expect(played().map(([, n]) => n)).toEqual(["merge-t1", "merge-t2", "chain-1"]);
});
