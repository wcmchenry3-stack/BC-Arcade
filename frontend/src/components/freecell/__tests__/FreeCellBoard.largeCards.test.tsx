/**
 * FreeCellBoard with Large cards (#3347): the board scrolls sideways only when
 * `scrollable`, its scroll buttons appear only while it is wider than the
 * screen, and taps, drops and hint frames still work at the larger card size.
 *
 * Drops go through the real DragProvider with DropTarget replaced by a
 * recorder (as FreeCellBoard.drag.test.tsx does). Swiping never scrolls the
 * board (the ScrollView is scrollEnabled={false}, so no native arbitration with
 * a card's drag can arise); the chevron buttons scroll it with scrollTo.
 */
import React from "react";
import { ScrollView, StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import { CardSizeContext } from "../../../game/_shared/CardSizeContext";
import { LARGE_CARD_WIDTH, largeCardSize } from "../../../game/freecell/largeCards";
import type { DragCard, DragSource } from "../../../game/_shared/drag/DragContext";
import type { FreeCellState } from "../../../game/freecell/types";
import {
  createDropSink,
  dropOn,
  legalTargets,
  resetDropSink,
} from "../../../test-utils/mockScreenDeps";

const mockDrops = createDropSink();
jest.mock("../../../game/_shared/drag/DropTarget", () =>
  mockScreenDeps().mockDropTarget(() => mockDrops)
);
jest.mock("../../../game/_shared/useSound", () => ({
  useSound: () => ({ play: jest.fn(() => true), stop: jest.fn() }),
}));

// 3♥ (col 0) fits the 4♣ and 4♠ of columns 1 and 2.
const STATE: FreeCellState = {
  _v: 1,
  tableau: [
    [{ suit: "hearts", rank: 3 }],
    [{ suit: "clubs", rank: 4 }],
    [{ suit: "spades", rank: 4 }],
    [{ suit: "diamonds", rank: 1 }],
    [],
    [],
    [],
    [],
  ],
  freeCells: [{ suit: "spades", rank: 1 }, null, null, null],
  foundations: { spades: [], hearts: [], diamonds: [], clubs: [] },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

const LARGE = largeCardSize(40, 57);
const BOARD_W = 8 * LARGE_CARD_WIDTH + 7 * 2;
const SOURCE: DragSource = { game: "freecell", type: "tableau", col: 0, fromIndex: 0 };
const CARD: DragCard = {
  suit: "hearts",
  rank: 3,
  width: LARGE.cardWidth,
  height: LARGE.cardHeight,
};

async function renderBoard(props: { scrollable?: boolean; state?: FreeCellState } = {}) {
  const onMove = jest.fn();
  const utils = await render(
    <ThemeProvider>
      <CardSizeContext.Provider value={LARGE}>
        <FreeCellBoard state={props.state ?? STATE} onMove={onMove} scrollable={props.scrollable} />
      </CardSizeContext.Provider>
    </ThemeProvider>
  );
  return { ...utils, onMove };
}

const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 400 } } });

beforeEach(() => resetDropSink(mockDrops));

describe("FreeCellBoard — Large cards scroll container", () => {
  it("has no ScrollView when not scrollable (the default board is unchanged)", async () => {
    const { queryByTestId } = await renderBoard();
    expect(queryByTestId("freecell-board-hscroll")).toBeNull();
    expect(queryByTestId("freecell-scroll-left")).toBeNull();
  });

  it("wraps the board in a horizontal ScrollView when scrollable", async () => {
    const { getByTestId } = await renderBoard({ scrollable: true });
    const scroll = getByTestId("freecell-board-hscroll");
    expect(scroll.props.horizontal).toBe(true);
    // Swiping never scrolls the board: the buttons do.
    expect(scroll.props.scrollEnabled).toBe(false);
  });

  it("lays the board out at the large card width", async () => {
    const { getByLabelText } = await renderBoard({ scrollable: true });
    expect(getByLabelText("Empty free cell 2")).toHaveStyle({ width: LARGE.cardWidth });
  });

  it("shows the scroll buttons only while the board is wider than the screen", async () => {
    const { getByTestId, queryByTestId } = await renderBoard({ scrollable: true });
    // No layout yet: the width is unknown, so no buttons.
    expect(queryByTestId("freecell-scroll-left")).toBeNull();

    await fireEvent(getByTestId("freecell-board-hscroll"), "layout", layout(BOARD_W - 100));
    expect(getByTestId("freecell-scroll-left")).toBeTruthy();
    expect(getByTestId("freecell-scroll-right")).toBeTruthy();

    // A wide tablet: the board fits, nothing to scroll.
    await fireEvent(getByTestId("freecell-board-hscroll"), "layout", layout(BOARD_W + 100));
    expect(queryByTestId("freecell-scroll-left")).toBeNull();
  });

  it("labels the scroll buttons for screen readers", async () => {
    const { getByTestId, getByLabelText } = await renderBoard({ scrollable: true });
    await fireEvent(getByTestId("freecell-board-hscroll"), "layout", layout(300));
    expect(getByLabelText("Scroll board left")).toBeTruthy();
    expect(getByLabelText("Scroll board right")).toBeTruthy();
  });

  it("the scroll buttons scroll the board, clamped to its ends", async () => {
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    try {
      const { getByTestId } = await renderBoard({ scrollable: true });
      const scroll = getByTestId("freecell-board-hscroll");
      await fireEvent(scroll, "layout", layout(300));
      await fireEvent(scroll, "contentSizeChange", BOARD_W, 400);

      await fireEvent.press(getByTestId("freecell-scroll-right"));
      expect(scrollTo).toHaveBeenLastCalledWith({ x: 300 * 0.6, animated: true });
      await fireEvent.press(getByTestId("freecell-scroll-right"));
      await fireEvent.press(getByTestId("freecell-scroll-right"));
      // The end of the board: content width - visible width.
      expect(scrollTo).toHaveBeenLastCalledWith({ x: BOARD_W - 300, animated: true });
      await fireEvent.press(getByTestId("freecell-scroll-left"));
      expect(scrollTo).toHaveBeenLastCalledWith({ x: BOARD_W - 300 - 180, animated: true });
    } finally {
      scrollTo.mockRestore();
    }
  });
});

describe("FreeCellBoard — Large cards scroll buttons and clipping", () => {
  async function renderScrolling() {
    const scrollTo = jest.spyOn(ScrollView.prototype, "scrollTo").mockImplementation(() => {});
    scrollToSpy = scrollTo;
    const utils = await renderBoard({ scrollable: true });
    const scroll = utils.getByTestId("freecell-board-hscroll");
    await fireEvent(scroll, "layout", layout(300));
    await fireEvent(scroll, "contentSizeChange", 534, 400);
    return { ...utils, scroll, scrollTo };
  }
  let scrollToSpy: jest.SpyInstance | null = null;
  afterEach(() => scrollToSpy?.mockRestore());

  it("the buttons are at least 44 dp tall with a hit slop", async () => {
    const { getByTestId } = await renderScrolling();
    const button = getByTestId("freecell-scroll-right");
    expect(StyleSheet.flatten(button.props.style).height).toBeGreaterThanOrEqual(44);
    expect(button.props.hitSlop).toEqual(expect.objectContaining({ top: 4, bottom: 4 }));
  });

  it("clamps a remembered offset when the viewport changes, before the next press", async () => {
    const { getByTestId, scroll, scrollTo } = await renderScrolling();
    for (let i = 0; i < 3; i++) await fireEvent.press(getByTestId("freecell-scroll-right"));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 234, animated: true });
    // A resize: the board now ends at 154, so the first press back starts there.
    await fireEvent(scroll, "layout", layout(380));
    await fireEvent.press(getByTestId("freecell-scroll-left"));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 0, animated: true });
  });

  it("starts the next press from the offset the ScrollView reports", async () => {
    const { getByTestId, scroll, scrollTo } = await renderScrolling();
    await fireEvent.press(getByTestId("freecell-scroll-right"));
    await fireEvent(scroll, "scroll", { nativeEvent: { contentOffset: { x: 50, y: 0 } } });
    await fireEvent.press(getByTestId("freecell-scroll-right"));
    expect(scrollTo).toHaveBeenLastCalledWith({ x: 230, animated: true });
  });

  it("pads the scrolled board so hint frames are not clipped, and keeps it LTR", async () => {
    const { scroll } = await renderScrolling();
    const content = StyleSheet.flatten(scroll.props.contentContainerStyle);
    expect(content.padding).toBeGreaterThanOrEqual(4);
    // An RTL language (ar, he) on web must not flip the cards or reverse the scroll offsets.
    expect(content.direction).toBe("ltr");
  });

  it("the button strip and padding come out of the tableau height budget", async () => {
    const pile = Array.from({ length: 13 }, (_, i) => ({
      suit: i % 2 === 0 ? ("spades" as const) : ("hearts" as const),
      rank: 13 - i,
    }));
    const state: FreeCellState = { ...STATE, tableau: [pile, [], [], [], [], [], [], []] };
    const topOfLast = async (viewport: number) => {
      const utils = await render(
        <ThemeProvider>
          <CardSizeContext.Provider value={LARGE}>
            <FreeCellBoard state={state} onMove={jest.fn()} scrollable availableHeight={500} />
          </CardSizeContext.Provider>
        </ThemeProvider>
      );
      await fireEvent(utils.getByTestId("freecell-board-hscroll"), "layout", layout(viewport));
      await fireEvent(utils.getByTestId("freecell-top-row"), "layout", {
        nativeEvent: { layout: { x: 0, y: 0, width: BOARD_W, height: 100 } },
      });
      const top = StyleSheet.flatten(utils.getByTestId("freecell-col-0-top").props.style).top;
      await utils.unmount();
      return top as number;
    };
    // 500 high, less the 100 top row, the 8 row gap and 8 padding, less the 48 button strip when it shows.
    expect(await topOfLast(300)).toBeCloseTo(500 - 100 - 8 - 8 - 48 - LARGE.cardHeight, 0);
    expect(await topOfLast(BOARD_W + 100)).toBeCloseTo(500 - 100 - 8 - 8 - LARGE.cardHeight, 0);
  });
});

describe("FreeCellBoard — Large cards keep tap, drop and hints working", () => {
  it("tap-to-select then tap a destination still moves the card", async () => {
    const { getByLabelText, onMove } = await renderBoard({ scrollable: true });
    await fireEvent.press(getByLabelText("3 of Hearts"));
    expect(getByLabelText("3 of Hearts (selected)")).toBeTruthy();
    await fireEvent.press(getByLabelText("4 of Clubs"));
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
  });

  it("a drop on a legal column still moves the card", async () => {
    const { onMove } = await renderBoard({ scrollable: true });
    expect(await dropOn(mockDrops, "freecell-tableau-1", SOURCE, [CARD])).toBe(true);
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
  });

  it("never enables swipe scrolling, during a drag or after it", async () => {
    const { getByTestId } = await renderBoard({ scrollable: true });
    expect(getByTestId("freecell-board-hscroll").props.scrollEnabled).toBe(false);
    // Starts a drag through the board's own provider and leaves it live.
    await legalTargets(mockDrops, SOURCE, [CARD]);
    expect(getByTestId("freecell-board-hscroll").props.scrollEnabled).toBe(false);
    await act(async () => {
      mockDrops.drag?.cancelDrag("test");
    });
    expect(getByTestId("freecell-board-hscroll").props.scrollEnabled).toBe(false);
  });

  it("hint frames still render", async () => {
    const hinted: FreeCellState = {
      ...STATE,
      hint: { type: "tableau-to-tableau", fromCol: 0, fromIndex: 0, toCol: 1 },
    };
    const { getByTestId } = await renderBoard({ scrollable: true, state: hinted });
    expect(getByTestId("hint-frame-source")).toBeTruthy();
    expect(getByTestId("hint-frame-destination")).toBeTruthy();
  });
});
