/**
 * The board's motion (#3689): the two tiles of a merge slide into it (a ghost each, from the cell
 * they started in), the merged tile waits unseen until they meet, the 2048 tile glows, the stuck
 * board dims for the game-over beat, and none of it under Reduce Motion. (The reanimated mock
 * applies a style's start values and a write's target at once: a test reads the first render.)
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import Grid from "../Grid";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { TileData } from "../../../game/twenty48/types";

let mockReduceMotion = false;
jest.mock("../../shared/useReduceMotion", () => ({
  ...jest.requireActual("../../shared/useReduceMotion"),
  useReduceMotion: () => mockReduceMotion,
}));

beforeEach(() => {
  mockReduceMotion = false;
});

// The test window's board: 360 wide, 80 px tiles, an 8 px gap.
const cell = (i: number) => 8 + i * 88;

function tile(over: Partial<TileData> & Pick<TileData, "id" | "value" | "row" | "col">): TileData {
  return { prevRow: over.row, prevCol: over.col, isNew: false, isMerge: false, ...over };
}

const MERGED: TileData = tile({
  id: 20,
  value: 4,
  row: 0,
  col: 0,
  prevRow: null,
  prevCol: null,
  isMerge: true,
  mergedFrom: [
    { id: 10, row: 0, col: 1 },
    { id: 11, row: 0, col: 3 },
  ],
});

async function renderGrid(tiles: TileData[], beat?: "win" | "gameOver" | null) {
  return await render(
    <ThemeProvider>
      <Grid tiles={tiles} beat={beat} />
    </ThemeProvider>
  );
}

// The ghosts are hidden from screen readers, which is also what the queries skip by default.
const hidden = { includeHiddenElements: true };

const styleOf = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as object) as Record<string, number>;

describe("Grid: sliding merges", () => {
  it("slides both source tiles in, each starting in the cell it came from", async () => {
    const { getByTestId } = await renderGrid([MERGED]);
    const a = styleOf(getByTestId("twenty48-ghost-20-10", hidden));
    const b = styleOf(getByTestId("twenty48-ghost-20-11", hidden));
    expect([a.top, a.left]).toEqual([cell(0), cell(1)]);
    expect([b.top, b.left]).toEqual([cell(0), cell(3)]);
  });

  it("each ghost shows half the merged value, hidden from screen readers", async () => {
    const { getByTestId, getAllByText } = await renderGrid([MERGED]);
    expect(getAllByText("2", hidden)).toHaveLength(2);
    expect(getByTestId("twenty48-ghost-20-10", hidden).props["aria-hidden"]).toBe(true);
    expect(getByTestId("twenty48-ghost-20-11", hidden).props.accessibilityLabel).toBeUndefined();
  });

  it("the merged tile waits, unseen, for them to meet", async () => {
    const { getByLabelText } = await renderGrid([MERGED]);
    expect(styleOf(getByLabelText("4")).opacity).toBe(0);
  });

  it("a merged tile with no mergedFrom (an old save) just pops where it is: no ghosts, no wait", async () => {
    const { queryByTestId, getByLabelText } = await renderGrid([
      { ...MERGED, mergedFrom: undefined },
    ]);
    expect(queryByTestId(/twenty48-ghost/, hidden)).toBeNull();
    expect(styleOf(getByLabelText("4")).opacity).toBe(1);
  });

  it("a tile that only slides has no ghosts and is visible", async () => {
    const { queryByTestId, getByLabelText } = await renderGrid([
      tile({ id: 1, value: 8, row: 1, col: 0, prevRow: 1, prevCol: 3 }),
    ]);
    expect(queryByTestId(/twenty48-ghost/, hidden)).toBeNull();
    expect(styleOf(getByLabelText("8")).opacity).toBe(1);
  });

  it("a spawned tile starts small and unseen", async () => {
    const { getByLabelText } = await renderGrid([
      tile({ id: 2, value: 2, row: 2, col: 2, prevRow: null, prevCol: null, isNew: true }),
    ]);
    const style = styleOf(getByLabelText("2"));
    expect(style.opacity).toBe(0);
    expect(style.transform).toEqual([{ scale: 0.4 }]);
  });

  it("under Reduce Motion: no ghosts, and the merged and spawned tiles are simply there", async () => {
    mockReduceMotion = true;
    const spawned = tile({
      id: 2,
      value: 2,
      row: 2,
      col: 2,
      prevRow: null,
      prevCol: null,
      isNew: true,
    });
    const { queryByTestId, getByLabelText } = await renderGrid([MERGED, spawned]);
    expect(queryByTestId(/twenty48-ghost/, hidden)).toBeNull();
    expect(styleOf(getByLabelText("4")).opacity).toBe(1);
    expect(styleOf(getByLabelText("2")).opacity).toBe(1);
    expect(styleOf(getByLabelText("2")).transform).toEqual([{ scale: 1 }]);
  });

  it("a tile that moved starts in its old cell, and on its cell at once under Reduce Motion", async () => {
    const moved = tile({ id: 1, value: 8, row: 1, col: 0, prevRow: 1, prevCol: 3 });
    const normal = await renderGrid([moved]);
    expect(styleOf(normal.getByLabelText("8")).left).toBe(cell(3));
    await normal.unmount();

    mockReduceMotion = true;
    const reduced = await renderGrid([moved]);
    expect(styleOf(reduced.getByLabelText("8")).left).toBe(cell(0));
  });
});

describe("Grid: the 2048 tile", () => {
  const WIN = tile({
    id: 30,
    value: 2048,
    row: 0,
    col: 0,
    prevRow: null,
    prevCol: null,
    isMerge: true,
    mergedFrom: [
      { id: 1, row: 0, col: 1 },
      { id: 2, row: 0, col: 2 },
    ],
  });

  it("the 2048 a merge forms glows", async () => {
    const { getByTestId } = await renderGrid([WIN]);
    expect(getByTestId("twenty48-win-glow")).toBeTruthy();
  });

  it("a 2048 that is merely on the board, or a smaller merge, does not", async () => {
    const resting = await renderGrid([{ ...WIN, isMerge: false, mergedFrom: undefined }]);
    expect(resting.queryByTestId("twenty48-win-glow")).toBeNull();
    await resting.unmount();
    const small = await renderGrid([MERGED]);
    expect(small.queryByTestId("twenty48-win-glow")).toBeNull();
  });

  it("no glow under Reduce Motion", async () => {
    mockReduceMotion = true;
    const { queryByTestId } = await renderGrid([WIN]);
    expect(queryByTestId("twenty48-win-glow")).toBeNull();
  });
});

describe("Grid: the game-over beat", () => {
  it("dims the stuck board while the beat plays", async () => {
    const { getByTestId } = await renderGrid([MERGED], "gameOver");
    expect(getByTestId("twenty48-dim")).toBeTruthy();
  });

  it("not before it, after it, or for the win's beat", async () => {
    for (const beat of [null, undefined, "win"] as const) {
      const r = await renderGrid([MERGED], beat);
      expect(r.queryByTestId("twenty48-dim")).toBeNull();
      await r.unmount();
    }
  });

  it("not under Reduce Motion", async () => {
    mockReduceMotion = true;
    const { queryByTestId } = await renderGrid([MERGED], "gameOver");
    expect(queryByTestId("twenty48-dim")).toBeNull();
  });
});
