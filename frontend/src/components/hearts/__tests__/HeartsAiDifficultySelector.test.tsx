import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import HeartsAiDifficultySelector from "../HeartsAiDifficultySelector";

describe("HeartsAiDifficultySelector (#3158)", () => {
  it("offers Conservative first, then the legacy styles and the Mixed Table", async () => {
    const onChange = jest.fn();
    const { getByTestId, getAllByRole } = await render(
      <ThemeProvider>
        <HeartsAiDifficultySelector value="conservative" onChange={onChange} />
      </ThemeProvider>
    );
    expect(getAllByRole("radio").map((r) => r.props.testID)).toEqual([
      "hearts-difficulty-conservative",
      "hearts-difficulty-cautious",
      "hearts-difficulty-schemer",
      "hearts-difficulty-daring",
      "hearts-difficulty-mixed",
    ]);
    expect(getByTestId("hearts-difficulty-conservative").props.accessibilityState.checked).toBe(
      true
    );
    expect(getAllByRole("radio")[0]!.props.accessibilityLabel).toMatch(/conservative/i);
    await fireEvent.press(getByTestId("hearts-difficulty-daring"));
    expect(onChange).toHaveBeenCalledWith("daring");
  });
});
