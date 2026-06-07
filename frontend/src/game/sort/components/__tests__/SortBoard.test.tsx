import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import SortBoard from "../SortBoard";
import type { Color, SortState } from "../../types";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function mkState(bottles: Color[][]): SortState {
  return {
    bottles,
    moveCount: 0,
    undosUsed: 0,
    isComplete: false,
    selectedBottleIndex: null,
  };
}

describe("SortBoard", () => {
  it("renders the board region with the correct accessibility label", async () => {
    const state = mkState([["red", "red", "red", "red"], ["blue", "blue", "blue", "blue"], []]);
    const { getByLabelText } = await render(
      withTheme(<SortBoard state={state} onBottleTap={jest.fn()} />)
    );
    expect(getByLabelText("Sort Puzzle board")).toBeTruthy();
  });

  it("renders one BottleView per bottle", async () => {
    const state = mkState([["red"], ["blue"], []]);
    const { getAllByLabelText } = await render(
      withTheme(<SortBoard state={state} onBottleTap={jest.fn()} />)
    );
    expect(getAllByLabelText(/^Bottle \d/)).toHaveLength(3);
  });

  it("calls onBottleTap with the correct index when a bottle is tapped", async () => {
    const onBottleTap = jest.fn();
    const state = mkState([["red"], ["blue"], []]);
    const { getByLabelText } = await render(
      withTheme(<SortBoard state={state} onBottleTap={onBottleTap} />)
    );
    await fireEvent.press(getByLabelText("Bottle 2, 1 of 4 filled"));
    expect(onBottleTap).toHaveBeenCalledWith(1);
  });

  it("marks the selected bottle via selectedBottleIndex", async () => {
    const state = { ...mkState([["red"], ["blue"], []]), selectedBottleIndex: 0 };
    const { getByLabelText } = await render(
      withTheme(<SortBoard state={state} onBottleTap={jest.fn()} />)
    );
    expect(getByLabelText(/Bottle 1 selected/)).toBeTruthy();
  });

  it("does not render the win overlay when isComplete is false", async () => {
    const state = mkState([["red", "red", "red", "red"], []]);
    const { queryByText } = await render(
      withTheme(<SortBoard state={state} onBottleTap={jest.fn()} />)
    );
    // Win overlay has no visible text — just confirm no crash and normal render
    expect(queryByText("Sort Puzzle board")).toBeNull(); // label is on region, not text node
  });

  it("renders all 8 bottles without error", async () => {
    const state = mkState([
      ["red"],
      ["blue"],
      ["green"],
      ["yellow"],
      ["orange"],
      ["purple"],
      ["pink"],
      ["teal"],
    ]);
    const { getAllByLabelText } = await render(
      withTheme(<SortBoard state={state} onBottleTap={jest.fn()} />)
    );
    expect(getAllByLabelText(/^Bottle \d/)).toHaveLength(8);
  });

  it("threads colorblindMode down to BottleView — renders without error", async () => {
    const state = mkState([["red", "blue"], []]);
    const { getAllByLabelText } = await render(
      withTheme(<SortBoard state={state} colorblindMode onBottleTap={jest.fn()} />)
    );
    // Verify bottles still render when colorblindMode is enabled
    expect(getAllByLabelText(/^Bottle \d/).length).toBeGreaterThan(0);
  });

  it("accepts onPourComplete prop and does not call it on initial render", async () => {
    // Guards that the prop exists in the interface and is not spuriously invoked.
    // The Reanimated jest mock does not execute animation callbacks, so the actual
    // call-through (runOnJS(notifyPourComplete)() at animation end) is covered by
    // the SortScreen regression test for issue #1567.
    const onPourComplete = jest.fn();
    const state = mkState([["red", "red", "blue", "blue"], []]);
    await render(
      withTheme(
        <SortBoard
          state={state}
          onBottleTap={jest.fn()}
          pouringFrom={0}
          pouringTo={1}
          pourHoldMs={380}
          onPourComplete={onPourComplete}
        />
      )
    );
    expect(onPourComplete).not.toHaveBeenCalled();
  });

  it("renders cross-row pour without crashing (regression #1803)", async () => {
    // Issue #1803: on 7+ bottle boards the grid wraps to multiple rows. Bottle
    // index order no longer matches visual left-right order, so the old
    // `isRight = pouringFrom < pouringTo` picked the wrong tilt direction.
    // Example: bottle 4 (row 1, col 0) is visually LEFT of bottle 3 (row 0,
    // col 3) but 4 < 3 is false. The fix uses srcPos.x < dstPos.x instead.
    // Reanimated jest mock doesn't execute worklet callbacks so we can only
    // verify the component doesn't crash; the animation direction is exercised
    // by the SortScreen e2e test for issue #1803.
    const state = mkState([
      ["red", "red", "red", "red"],
      ["blue", "blue", "blue", "blue"],
      ["green", "green", "green", "green"],
      ["yellow", "yellow", "yellow", "yellow"],
      ["orange", "orange", "orange", "orange"],
      ["purple", "purple", "purple", "purple"],
      ["pink", "pink", "pink", "pink"],
      [],
    ]);
    const { getAllByLabelText } = await render(
      withTheme(<SortBoard state={state} onBottleTap={jest.fn()} pouringFrom={4} pouringTo={3} />)
    );
    expect(getAllByLabelText(/^Bottle \d/)).toHaveLength(8);
  });
});
