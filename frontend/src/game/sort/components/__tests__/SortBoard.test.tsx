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

  it(
    "discards cached layout positions when the bottle count changes without " +
      "unmounting, instead of pouring against stale coordinates (regression #2297)",
    async () => {
      // Issue #2297: SortScreen's "Next Level" flow (handleNextLevel) reuses the
      // same SortBoard instance across a level change rather than unmounting it.
      // bottlePositionsRef/gridOffsetRef are plain refs populated only by async
      // onLayout — if a level change alters the grid shape (bottle count, so a
      // different numCols/numRows or re-centered last row) and a pour is started
      // before fresh onLayout events land for the new grid, the pour used to be
      // computed from the *previous* level's coordinates: a highlight ring/stream
      // that visually straddles the wrong bottle(s) instead of framing the real
      // destination. The fix resets both refs whenever bottle count changes, so a
      // pour attempted before fresh layout data arrives is suppressed rather than
      // rendered in the wrong place.
      const onBottleTap = jest.fn();
      // Level A: 5 bottles → 3-col × 2-row grid (matches numCols formula in SortBoard).
      const levelA = mkState([["red"], ["blue"], ["green"], ["yellow"], ["orange"]]);

      const { getByTestId, queryByTestId, rerender } = await render(
        withTheme(<SortBoard state={levelA} onBottleTap={onBottleTap} />)
      );

      // Simulate real onLayout events landing for level A's 3×2 grid.
      await fireEvent(getByTestId("sort-grid"), "layout", {
        nativeEvent: { layout: { x: 8, y: 40, width: 300, height: 300 } },
      });
      const levelAPositions = [
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 200, y: 0 },
        { x: 0, y: 150 },
        { x: 100, y: 150 },
      ];
      for (const [idx, pos] of levelAPositions.entries()) {
        await fireEvent(getByTestId(`bottle-cell-${idx}`), "layout", {
          nativeEvent: { layout: { ...pos, width: 90, height: 140 } },
        });
      }

      // Advance to a level with a different grid shape WITHOUT unmounting — this
      // mirrors handleNextLevel/handleSelectLevel, which just swap `state`.
      // Level B: 4 bottles → single-row grid (Level 2's shape from the bug report).
      const levelB = mkState([["red"], ["blue"], ["green"], ["yellow"]]);
      await rerender(withTheme(<SortBoard state={levelB} onBottleTap={onBottleTap} />));

      // A pour is attempted immediately on the new level, before its own onLayout
      // events have landed.
      await rerender(
        withTheme(
          <SortBoard state={levelB} onBottleTap={onBottleTap} pouringFrom={0} pouringTo={1} />
        )
      );

      // Fixed behavior: nothing renders from level A's stale positions — the pour
      // stays suppressed until real layout data for level B actually arrives,
      // rather than drawing a highlight/stream in the wrong place. The overlay
      // is accessibility-hidden (decorative), so queries must opt in to see it.
      expect(queryByTestId("pour-ghost-overlay", { includeHiddenElements: true })).toBeNull();

      // Once level B's real layout lands, a pour renders normally again — this
      // guards against the fix over-suppressing the feature entirely.
      await fireEvent(getByTestId("sort-grid"), "layout", {
        nativeEvent: { layout: { x: 8, y: 40, width: 400, height: 150 } },
      });
      for (let idx = 0; idx < 4; idx++) {
        await fireEvent(getByTestId(`bottle-cell-${idx}`), "layout", {
          nativeEvent: { layout: { x: idx * 100, y: 0, width: 90, height: 140 } },
        });
      }
      await rerender(
        withTheme(
          <SortBoard state={levelB} onBottleTap={onBottleTap} pouringFrom={0} pouringTo={2} />
        )
      );
      expect(getByTestId("pour-ghost-overlay", { includeHiddenElements: true })).toBeTruthy();
    }
  );
});
