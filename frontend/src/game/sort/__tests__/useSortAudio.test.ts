/**
 * Sort's sound triggers (#3661): what plays, when, from the pour's timeline (motion.ts), and
 * nothing for a cancelled pour. The players are mocked, so a test sees which sound played and
 * when (fake timers).
 */
import { act, renderHook } from "@testing-library/react-native";
import {
  POUR_START_LATENCY_BUDGET_MS,
  POUR_UNIT_MS,
  pourTimeline,
  REDUCE_MOTION_POUR_MS,
} from "../motion";
import { useSortAudio } from "../useSortAudio";

/** Every play, in order, by the name of the sound (a variants group, or a single key). */
const mockPlayed: string[] = [];

jest.mock("../../_shared/useSound", () => ({
  useSound: (key: string) => ({ play: () => mockPlayed.push(key) > 0 }),
}));
jest.mock("../../_shared/useSoundVariants", () => ({
  useSoundVariants: (keys: readonly string[]) => ({ play: () => mockPlayed.push(keys[0]!) > 0 }),
}));

const GLUG = "sort.pourGlug";
const LIFT = "sort.pourLift";

/** Renders the hook with real timers (the renderer needs them), then fakes the clock. */
async function mount() {
  const rendered = await renderHook(() => useSortAudio());
  jest.useFakeTimers();
  return rendered;
}

beforeEach(() => {
  mockPlayed.length = 0;
});
afterEach(() => {
  jest.useRealTimers();
});

describe("Sort sound triggers", () => {
  it("each event plays its own sound once", async () => {
    const { result } = await mount();
    const a = result.current;
    a.playSelect();
    a.playRefused();
    a.playComplete();
    a.playUndo();
    a.playHint();
    a.playWin();
    expect(mockPlayed).toEqual([
      "sort.select",
      "sort.refused",
      "sort.complete",
      "sort.undo",
      "sort.hint",
      "sort.win",
    ]);
  });

  it("a pour plays the lift at the tap and no glug yet", async () => {
    const { result } = await mount();
    result.current.playPour(2, false);
    expect(mockPlayed).toEqual([LIFT]);
  });

  it.each([1, 2, 3, 4])("a %i-unit pour plays that many glugs, and one lift", async (units) => {
    const { result } = await mount();
    result.current.playPour(units, false);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPlayed.filter((s) => s === GLUG)).toHaveLength(units);
    expect(mockPlayed.filter((s) => s === LIFT)).toHaveLength(1);
  });

  it("schedules the glugs on the slots, not on the units' leave times", async () => {
    const { result } = await mount();
    result.current.playPour(4, false);
    const { flowStartMs } = pourTimeline(4);
    const slots = [0, 1, 2, 3].map(
      (i) => POUR_START_LATENCY_BUDGET_MS + flowStartMs + i * POUR_UNIT_MS
    );
    expect(slots).toEqual([350, 650, 950, 1250]);
    let now = 0;
    for (const [i, at] of slots.entries()) {
      await act(async () => {
        jest.advanceTimersByTime(at - 1 - now);
      });
      expect(mockPlayed.filter((s) => s === GLUG)).toHaveLength(i);
      await act(async () => {
        jest.advanceTimersByTime(1);
      });
      expect(mockPlayed.filter((s) => s === GLUG)).toHaveLength(i + 1);
      now = at;
    }
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPlayed.filter((s) => s === GLUG)).toHaveLength(4);
    expect(mockPlayed.filter((s) => s === LIFT)).toHaveLength(1);
  });

  it("a cancelled pour plays no glug after the lift", async () => {
    const { result } = await mount();
    result.current.playPour(3, false);
    await act(async () => {
      jest.advanceTimersByTime(400); // the first glug has played
    });
    expect(mockPlayed.filter((s) => s === GLUG)).toHaveLength(1);
    result.current.cancelPour();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPlayed.filter((s) => s === GLUG)).toHaveLength(1);
  });

  it("unmounting drops the pour's pending glugs", async () => {
    const { result, unmount } = await mount();
    result.current.playPour(4, false);
    await unmount();
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPlayed).toEqual([LIFT]);
  });

  it("a new pour drops the old one's pending glugs", async () => {
    const { result } = await mount();
    result.current.playPour(4, false);
    result.current.playPour(1, false);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPlayed.filter((s) => s === LIFT)).toHaveLength(2);
    expect(mockPlayed.filter((s) => s === GLUG)).toHaveLength(1);
  });

  it("under Reduce Motion the pour lands at once: the lift and a single glug, now", async () => {
    expect(REDUCE_MOTION_POUR_MS).toBe(0);
    const { result } = await mount();
    result.current.playPour(4, true);
    expect(mockPlayed).toEqual([LIFT, GLUG]);
    await act(async () => {
      jest.advanceTimersByTime(5000);
    });
    expect(mockPlayed).toEqual([LIFT, GLUG]);
  });
});
