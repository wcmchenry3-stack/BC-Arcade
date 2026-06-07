import React from "react";
import { render } from "@testing-library/react-native";
import ScoreBoard from "../ScoreBoard";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function renderScoreBoard(props: { score: number; bestScore?: number; scoreDelta?: number }) {
  const { score, bestScore = 0, scoreDelta = 0 } = props;
  return await render(
    <ThemeProvider>
      <ScoreBoard score={score} bestScore={bestScore} scoreDelta={scoreDelta} />
    </ThemeProvider>
  );
}

describe("ScoreBoard", () => {
  it("renders the numeric score", async () => {
    const { getByText } = await renderScoreBoard({ score: 1024 });
    expect(getByText("1024")).toBeTruthy();
  });

  it("renders score of 0", async () => {
    const { getByLabelText } = await renderScoreBoard({ score: 0 });
    expect(getByLabelText("Current score: 0")).toBeTruthy();
  });

  it("renders 'Score' label text", async () => {
    const { getByText } = await renderScoreBoard({ score: 0 });
    expect(getByText("Score")).toBeTruthy();
  });

  it("renders the best score", async () => {
    const { getByText } = await renderScoreBoard({ score: 100, bestScore: 4096 });
    expect(getByText("4096")).toBeTruthy();
  });

  it("applies i18n accessibilityLabel with interpolated score", async () => {
    const { getByLabelText } = await renderScoreBoard({ score: 512 });
    expect(getByLabelText("Current score: 512")).toBeTruthy();
  });

  it("applies i18n accessibilityLabel for best score", async () => {
    const { getByLabelText } = await renderScoreBoard({ score: 0, bestScore: 2048 });
    expect(getByLabelText("Best score: 2048")).toBeTruthy();
  });

  it("updates accessibilityLabel when score prop changes", async () => {
    const { getByLabelText, rerender } = await renderScoreBoard({ score: 100 });
    expect(getByLabelText("Current score: 100")).toBeTruthy();
    await rerender(
      <ThemeProvider>
        <ScoreBoard score={200} bestScore={0} scoreDelta={0} />
      </ThemeProvider>
    );
    expect(getByLabelText("Current score: 200")).toBeTruthy();
  });

  it("updates displayed value when score prop changes", async () => {
    const { getByText, rerender } = await renderScoreBoard({ score: 100 });
    expect(getByText("100")).toBeTruthy();
    await rerender(
      <ThemeProvider>
        <ScoreBoard score={9999} bestScore={0} scoreDelta={0} />
      </ThemeProvider>
    );
    expect(getByText("9999")).toBeTruthy();
  });

  it("renders floating +delta when scoreDelta > 0", async () => {
    const { getByTestId } = await renderScoreBoard({ score: 100, bestScore: 0, scoreDelta: 16 });
    const delta = getByTestId("scoreboard-delta", { includeHiddenElements: true });
    expect(delta.props.children).toBe("+16");
  });

  it("does not render +delta when scoreDelta is 0", async () => {
    const { queryByTestId } = await renderScoreBoard({ score: 100, bestScore: 0, scoreDelta: 0 });
    expect(queryByTestId("scoreboard-delta", { includeHiddenElements: true })).toBeNull();
  });
});
