/**
 * The score commit (#3749): a scored cell pops 1 to 1.2 and back over 260 ms (yours and the
 * computer's), the total counts up over 300 ms, the upper bonus pulses; none of it on mount (a
 * restored game) or under Reduce Motion.
 */
import React from "react";
import { act, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";
import ScoreTable from "../ScoreTable";
import { CountUpText } from "../scoreMotion";
import { ThemeProvider } from "../../../theme/ThemeContext";
import {
  BONUS_PULSE_MS,
  BONUS_PULSE_SCALE,
  SCORE_POP_MS,
  SCORE_POP_SCALE,
  TOTAL_COUNT_MS,
} from "../../../game/yacht/motion";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  ...jest.requireActual("../../shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

const KEYS = [
  "ones",
  "twos",
  "threes",
  "fours",
  "fives",
  "sixes",
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
];
const EMPTY = Object.fromEntries(KEYS.map((k) => [k, null])) as Record<string, number | null>;

type TableProps = React.ComponentProps<typeof ScoreTable>;
const base: TableProps = {
  playerScores: EMPTY,
  playerPossibleScores: {},
  playerRollsUsed: 1,
  playerGameOver: false,
  playerTotalScore: 0,
  playerYachtBonusTotal: 0,
  cpu: { scores: EMPTY, totalScore: 0, yachtBonusTotal: 0 },
  isAiTurn: false,
  onScore: jest.fn(),
};
const table = (over: Partial<TableProps> = {}) => (
  <ThemeProvider>
    <ScoreTable {...base} {...over} />
  </ThemeProvider>
);

/** The pops started: the peak and the length of each `withSequence(up, down)`. */
function pops(seq: jest.SpyInstance, timing: jest.SpyInstance) {
  return seq.mock.calls.map((_c, i) => {
    const up = timing.mock.calls[i * 2]!;
    const down = timing.mock.calls[i * 2 + 1]!;
    return { peak: up[0], ms: up[1].duration + down[1].duration };
  });
}

beforeEach(() => {
  mockReduceMotion = false;
  jest.useFakeTimers();
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe("the score pop", () => {
  it("a restored card pops nothing", async () => {
    const seq = jest.spyOn(Reanimated, "withSequence");
    await render(table({ playerScores: { ...EMPTY, ones: 3 }, playerTotalScore: 3 }));
    expect(seq).not.toHaveBeenCalled();
  });

  it("your score pops its cell; the computer's pops its own", async () => {
    const r = await render(table());
    const seq = jest.spyOn(Reanimated, "withSequence");
    const timing = jest.spyOn(Reanimated, "withTiming");
    await r.rerender(table({ playerScores: { ...EMPTY, ones: 3 } }));
    expect(pops(seq, timing)).toEqual([{ peak: SCORE_POP_SCALE, ms: SCORE_POP_MS }]);
    await r.rerender(
      table({
        playerScores: { ...EMPTY, ones: 3 },
        cpu: { scores: { ...EMPTY, chance: 20 }, totalScore: 20, yachtBonusTotal: 0 },
      })
    );
    expect(pops(seq, timing)).toHaveLength(2);
  });

  it("earning the upper bonus pulses the +35", async () => {
    const upper = { ones: 3, twos: 6, threes: 9, fours: 12, fives: 15, sixes: null };
    const r = await render(table({ playerScores: { ...EMPTY, ...upper } }));
    const seq = jest.spyOn(Reanimated, "withSequence");
    const timing = jest.spyOn(Reanimated, "withTiming");
    await r.rerender(table({ playerScores: { ...EMPTY, ...upper, sixes: 18 } }));
    expect(pops(seq, timing)).toEqual([
      { peak: SCORE_POP_SCALE, ms: SCORE_POP_MS },
      { peak: BONUS_PULSE_SCALE, ms: BONUS_PULSE_MS },
    ]);
  });

  it("under Reduce Motion nothing pops", async () => {
    mockReduceMotion = true;
    const r = await render(table());
    const seq = jest.spyOn(Reanimated, "withSequence");
    await r.rerender(table({ playerScores: { ...EMPTY, ones: 3 } }));
    expect(seq).not.toHaveBeenCalled();
  });
});

describe("CountUpText", () => {
  const text = (value: number, reduceMotion = false) => (
    <CountUpText value={value} reduceMotion={reduceMotion} testID="total" />
  );

  it("counts up to the new total over TOTAL_COUNT_MS, ease-out, and says the final value", async () => {
    const r = await render(text(71));
    await r.rerender(text(87));
    expect(r.getByTestId("total")).toHaveTextContent("71");
    expect(r.getByTestId("total").props.accessibilityLabel).toBe("87");
    await act(async () => {
      jest.advanceTimersByTime(TOTAL_COUNT_MS / 2);
    });
    const mid = Number(r.getByTestId("total").props.children);
    // Ease-out: past the middle by half time.
    expect(mid).toBeGreaterThan(79);
    expect(mid).toBeLessThan(87);
    await act(async () => {
      jest.advanceTimersByTime(TOTAL_COUNT_MS);
    });
    expect(r.getByTestId("total")).toHaveTextContent("87");
  });

  it("under Reduce Motion the total just changes", async () => {
    const r = await render(text(71, true));
    await r.rerender(text(87, true));
    expect(r.getByTestId("total")).toHaveTextContent("87");
  });

  it("Reduce Motion turned on mid-count shows the total; off again counts nothing", async () => {
    const r = await render(text(71));
    await r.rerender(text(87));
    await act(async () => {
      jest.advanceTimersByTime(50);
    });
    await r.rerender(text(87, true));
    expect(r.getByTestId("total")).toHaveTextContent("87");
    await r.rerender(text(87));
    expect(r.getByTestId("total")).toHaveTextContent("87");
  });
});
