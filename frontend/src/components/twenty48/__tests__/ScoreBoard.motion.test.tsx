/**
 * The score's "+N" float (#3689): it takes `SCORE_FLOAT_MS`, and under Reduce Motion (read live) it
 * does not float at all; turning Reduce Motion on mid-float stops it.
 */
import React from "react";
import { Animated } from "react-native";
import { render } from "@testing-library/react-native";
import ScoreBoard from "../ScoreBoard";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { SCORE_FLOAT_MS, SCORE_FLOAT_RISE_PX } from "../../../game/twenty48/motion";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  ...jest.requireActual("../../shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

const board = (delta: number, score = 100) => (
  <ThemeProvider>
    <ScoreBoard score={score} bestScore={0} scoreDelta={delta} />
  </ThemeProvider>
);
const hidden = { includeHiddenElements: true };

beforeEach(() => {
  mockReduceMotion = false;
});
afterEach(() => jest.restoreAllMocks());

describe("ScoreBoard: the +N float", () => {
  it("floats up and fades over the score-float time", async () => {
    const timing = jest.spyOn(Animated, "timing");
    const { getByTestId } = await render(board(16));
    expect(getByTestId("scoreboard-delta", hidden)).toBeTruthy();
    expect(timing).toHaveBeenCalledTimes(2);
    for (const call of timing.mock.calls) expect(call[1].duration).toBe(SCORE_FLOAT_MS);
    expect(timing.mock.calls.map((c) => c[1].toValue).sort((a, b) => a - b)).toEqual([
      -SCORE_FLOAT_RISE_PX,
      0,
    ]);
  });

  it("under Reduce Motion the score changes but nothing floats", async () => {
    mockReduceMotion = true;
    const timing = jest.spyOn(Animated, "timing");
    const { queryByTestId, getByText } = await render(board(16));
    expect(queryByTestId("scoreboard-delta", hidden)).toBeNull();
    expect(timing).not.toHaveBeenCalled();
    expect(getByText("100")).toBeTruthy();
  });

  it("turning Reduce Motion on mid-float removes the float and stops it", async () => {
    const stop = jest.fn();
    jest.spyOn(Animated, "parallel").mockReturnValue({
      start: jest.fn(),
      stop,
      reset: jest.fn(),
    } as unknown as Animated.CompositeAnimation);
    const { getByTestId, queryByTestId, rerender } = await render(board(16));
    expect(getByTestId("scoreboard-delta", hidden)).toBeTruthy();

    mockReduceMotion = true;
    await rerender(board(16));
    expect(queryByTestId("scoreboard-delta", hidden)).toBeNull();
    expect(stop).toHaveBeenCalled();

    // Turning it off again does not float the old delta once more.
    const timing = jest.spyOn(Animated, "timing");
    mockReduceMotion = false;
    await rerender(board(16));
    expect(timing).not.toHaveBeenCalled();
  });

  it("a new score after turning Reduce Motion off floats again", async () => {
    mockReduceMotion = true;
    const { rerender } = await render(board(16));
    mockReduceMotion = false;
    await rerender(board(16));
    const timing = jest.spyOn(Animated, "timing");
    await rerender(board(32, 132));
    expect(timing).toHaveBeenCalledTimes(2);
  });
});
