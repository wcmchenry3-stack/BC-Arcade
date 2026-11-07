import { renderHook } from "@testing-library/react-native";
import { useAutoCompleteRiffle, useRunSound } from "../useRunSound";

// Every sound edge, in order: "<key>" for a one-shot, "start:<key>" / "stop:<key>" for the loop.
const calls: string[] = [];
jest.mock("../useSound", () => ({
  useSound: (key: string) => ({ play: () => calls.push(key), stop: jest.fn() }),
}));
jest.mock("../useLoopSound", () => ({
  useLoopSound: (key: string) => ({
    start: () => calls.push(`start:${key}`),
    stop: () => calls.push(`stop:${key}`),
  }),
}));

const KEYS = { start: "t.start", loop: "t.loop", settle: "t.settle" } as const;
const REG = {} as Record<string, number>;

beforeEach(() => {
  calls.length = 0;
});

describe("useRunSound (#3563)", () => {
  it("does nothing while inactive", async () => {
    await renderHook(() => useRunSound(false, false, KEYS, REG));
    expect(calls).toEqual([]);
  });

  it("start + loop when the run begins; loop stop + settle when it ends finished", async () => {
    const { rerender } = await renderHook(
      ({ active, finished }) => useRunSound(active, finished, KEYS, REG),
      { initialProps: { active: false, finished: false } }
    );
    await rerender({ active: true, finished: false });
    expect(calls).toEqual(["t.start", "start:t.loop"]);
    await rerender({ active: true, finished: false }); // no edge, no sound
    await rerender({ active: false, finished: true });
    expect(calls).toEqual(["t.start", "start:t.loop", "stop:t.loop", "t.settle"]);
  });

  it("a run that ends unfinished stops the loop without the settle", async () => {
    const { rerender } = await renderHook(
      ({ active, finished }) => useRunSound(active, finished, KEYS, REG),
      { initialProps: { active: true, finished: false } }
    );
    await rerender({ active: false, finished: false });
    expect(calls).toEqual(["t.start", "start:t.loop", "stop:t.loop"]);
  });

  it("a game already finished when mounted plays nothing", async () => {
    await renderHook(() => useRunSound(false, true, KEYS, REG));
    expect(calls).toEqual([]);
  });
});

describe("useAutoCompleteRiffle (#3563)", () => {
  type Props = { auto: boolean; game: { isComplete: boolean } | null };

  it("keeps the run flag through a finished run, and clears it for the next game", async () => {
    const { result, rerender } = await renderHook(
      ({ auto, game }: Props) => useAutoCompleteRiffle(auto, game, KEYS, REG),
      { initialProps: { auto: false, game: { isComplete: false } } as Props }
    );
    await rerender({ auto: true, game: { isComplete: false } });
    result.current.current = true; // the screen marks its first automatic card
    await rerender({ auto: false, game: { isComplete: true } }); // the run won the game
    expect(result.current.current).toBe(true); // the last card's sound stays muted
    expect(calls).toContain("t.settle");
    await rerender({ auto: false, game: { isComplete: false } }); // a new deal
    expect(result.current.current).toBe(false);
  });

  it("clears the run flag when a run ends without finishing", async () => {
    const { result, rerender } = await renderHook(
      ({ auto, game }: Props) => useAutoCompleteRiffle(auto, game, KEYS, REG),
      { initialProps: { auto: true, game: { isComplete: false } } as Props }
    );
    result.current.current = true;
    await rerender({ auto: false, game: { isComplete: false } });
    expect(result.current.current).toBe(false);
    expect(calls).not.toContain("t.settle");
  });

  it("treats no game yet (null) as unfinished", async () => {
    await renderHook(() => useAutoCompleteRiffle(false, null, KEYS, REG));
    expect(calls).toEqual([]);
  });
});
