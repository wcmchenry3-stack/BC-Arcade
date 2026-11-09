/**
 * useDailyWordSounds (#3665): each tile's reveal sound plays as its colour shows, at its flip
 * midpoint, by result; a restored board is silent; a refusal plays the "no".
 */
import { act, renderHook } from "@testing-library/react-native";

import { useDailyWordSounds } from "../useDailyWordSounds";
import { FLIP_HALF_MS, TILE_STAGGER_MS } from "../../../game/daily_word/motion";
import { applyServerResult, initialState } from "../../../game/daily_word/engine";
import type { DailyWordState, TileState } from "../../../game/daily_word/types";

const played: string[] = [];
jest.mock("../../../game/_shared/useSound", () => ({
  useSound: (key: string) => ({ play: () => (played.push(key), true), stop: jest.fn() }),
}));
jest.mock("../../../game/_shared/useSoundVariants", () => ({
  useSoundVariants: (keys: readonly string[]) => ({
    play: () => (played.push(keys[0]!), true),
  }),
}));

const tiles = (word: string, statuses: string): TileState[] =>
  [...word].map((letter, i) => ({
    letter,
    status: ({ c: "correct", p: "present", a: "absent" } as const)[statuses[i] as "c" | "p" | "a"],
  }));

// SLATE: S L absent, A correct, T present, E correct.
const scored = applyServerResult(initialState("2026-11-09:en", 5, "en"), tiles("slate", "aacpc"));
const at = (i: number) => i * TILE_STAGGER_MS + FLIP_HALF_MS;

async function setup(state: DailyWordState, flipping: number | null) {
  return renderHook(
    ({ s, f }: { s: DailyWordState; f: number | null }) => useDailyWordSounds(s, f),
    { initialProps: { s: state, f: flipping } }
  );
}

beforeEach(() => {
  played.length = 0;
  jest.useFakeTimers();
});
afterEach(() => jest.useRealTimers());

describe("useDailyWordSounds", () => {
  it("plays each tile's result as its colour shows, never before", async () => {
    await setup(scored, 0);
    await act(() => jest.advanceTimersByTime(at(0) - 1));
    expect(played).toEqual([]);
    await act(() => jest.advanceTimersByTime(1));
    expect(played).toEqual(["dailyWord.revealMiss"]);
    await act(() => jest.advanceTimersByTime(at(4) - at(0)));
    expect(played).toEqual([
      "dailyWord.revealMiss",
      "dailyWord.revealMiss",
      "dailyWord.revealCorrect",
      "dailyWord.revealPresent",
      "dailyWord.revealCorrect",
    ]);
  });

  it("a restored board (nothing flipping) is silent", async () => {
    await setup(scored, null);
    await act(() => jest.advanceTimersByTime(5000));
    expect(played).toEqual([]);
  });

  it("an unmount mid-flip plays nothing more", async () => {
    const hook = await setup(scored, 0);
    await act(() => jest.advanceTimersByTime(at(1)));
    await hook.unmount();
    await act(() => jest.advanceTimersByTime(5000));
    expect(played).toHaveLength(2);
  });

  it("a refusal plays the refusal sound", async () => {
    const hook = await setup(scored, null);
    await act(() => hook.result.current.playRefused());
    expect(played).toEqual(["dailyWord.refused"]);
  });
});
