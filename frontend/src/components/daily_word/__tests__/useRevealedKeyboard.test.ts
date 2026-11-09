/**
 * useRevealedKeyboard (#3663): while a row flips, a key changes colour only once the tile for its
 * letter has turned over, never before, and never downgrades; otherwise the keyboard is the
 * game's own.
 */
import { act, renderHook } from "@testing-library/react-native";

import { useRevealedKeyboard } from "../useRevealedKeyboard";
import { FLIP_HALF_MS, TILE_STAGGER_MS } from "../WordTile";
import { applyServerResult, initialState } from "../../../game/daily_word/engine";
import type { DailyWordState, TileState } from "../../../game/daily_word/types";

const tiles = (word: string, statuses: string): TileState[] =>
  [...word].map((letter, i) => ({
    letter,
    status: ({ c: "correct", p: "present", a: "absent" } as const)[statuses[i] as "c" | "p" | "a"],
  }));

// SLATE against CRANE: S L absent, A correct, T absent, E correct. Then TRACE: T absent,
// R correct, A correct, C present, E correct.
const fresh = initialState("2026-11-09:en", 5, "en");
const afterSlate = applyServerResult(fresh, tiles("slate", "aacac"));
const afterTrace = applyServerResult(afterSlate, tiles("trace", "accpc"));

async function setup(state: DailyWordState, flipping: number | null) {
  return renderHook(
    ({ s, f }: { s: DailyWordState; f: number | null }) => useRevealedKeyboard(s, f),
    { initialProps: { s: state, f: flipping } }
  );
}
const at = (i: number) => i * TILE_STAGGER_MS + FLIP_HALF_MS;

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("useRevealedKeyboard", () => {
  it("is the game's keyboard when no row flips (a restore shows the final keys at once)", async () => {
    const hook = await setup(afterTrace, null);
    expect(hook.result.current).toEqual(afterTrace.keyboard_state);
  });

  it("holds each key back until its tile turns over", async () => {
    const hook = await setup(afterTrace, 1);
    // At the flip's start: only the earlier row's keys.
    expect(hook.result.current).toEqual(afterSlate.keyboard_state);
    expect(hook.result.current.r).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(at(0));
    });
    expect(hook.result.current.t).toBe("absent");
    expect(hook.result.current.r).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(at(1) - at(0));
    });
    expect(hook.result.current.r).toBe("correct");
    expect(hook.result.current.c).toBeUndefined();
    await act(async () => {
      jest.advanceTimersByTime(at(4));
    });
    expect(hook.result.current).toEqual(afterTrace.keyboard_state);
  });

  it("never downgrades a key the earlier rows already showed", async () => {
    const hook = await setup(afterTrace, 1);
    // A was correct after SLATE; it stays correct throughout TRACE's flip.
    for (let i = 0; i <= 4; i++) {
      expect(hook.result.current.a).toBe("correct");
      await act(async () => {
        jest.advanceTimersByTime(TILE_STAGGER_MS);
      });
    }
  });

  it("Play Again: the next game's first guess flips row 0 again and starts from none", async () => {
    const hook = await setup(afterSlate, 0);
    await act(async () => {
      jest.advanceTimersByTime(at(4));
    });
    await hook.rerender({ s: afterSlate, f: null });
    // A new game: row 0's guess is now TRACE, flipping in the same render it lands.
    const nextGame = applyServerResult(fresh, tiles("trace", "accpc"));
    await hook.rerender({ s: nextGame, f: 0 });
    expect(hook.result.current).toEqual({});
    await act(async () => {
      jest.advanceTimersByTime(at(0));
    });
    expect(hook.result.current).toEqual({ t: "absent" });
  });

  it("a new flip starts from none, not the last row's count", async () => {
    const hook = await setup(afterSlate, 0);
    await act(async () => {
      jest.advanceTimersByTime(at(4));
    });
    expect(hook.result.current).toEqual(afterSlate.keyboard_state);
    // The next guess lands and its row starts flipping in the same render.
    await hook.rerender({ s: afterTrace, f: 1 });
    expect(hook.result.current).toEqual(afterSlate.keyboard_state);
  });
});
