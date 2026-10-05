/**
 * FreeCellBoard drag-and-drop (#2957): what a drop on a tableau column, free
 * cell or foundation does, and which targets light up for a drag.
 *
 * The real DragProvider runs. DropTarget is replaced by a recorder, so the
 * test can start a drag through the provider (the board's own
 * `getLegalDropIds` answers it) and deliver a drop to the handler the board
 * gave each target, without laying out native views.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import FreeCellBoard from "../FreeCellBoard";
import type { DragCard, DragSource } from "../../../game/_shared/drag/DragContext";
import type { FreeCellState, Suit } from "../../../game/freecell/types";
import {
  createDropSink,
  dropOn,
  legalTargets as legalTargetsOf,
  resetDropSink,
} from "../../../test-utils/mockScreenDeps";

const mockDrops = createDropSink();
jest.mock("../../../game/_shared/drag/DropTarget", () =>
  mockScreenDeps().mockDropTarget(() => mockDrops)
);

jest.mock("../../../game/_shared/useSound", () => ({
  useSound: () => ({ play: jest.fn(() => true), stop: jest.fn() }),
}));

// Column 0 holds 3♥, which fits on the 4♣/4♠ of columns 1 and 2 and on the
// hearts foundation (A♥ 2♥). Cell 0 holds A♠ (it fits the empty spades
// foundation); cell 1 holds 3♦ (it fits 4♣/4♠). Column 6's 3♣ takes the
// foundation's 2♥. Columns 4 and 7 are empty.
const STATE: FreeCellState = {
  _v: 1,
  tableau: [
    [{ suit: "hearts", rank: 3 }],
    [{ suit: "clubs", rank: 4 }],
    [{ suit: "spades", rank: 4 }],
    [{ suit: "diamonds", rank: 1 }],
    [],
    [{ suit: "spades", rank: 13 }],
    [{ suit: "clubs", rank: 3 }],
    [],
  ],
  freeCells: [{ suit: "spades", rank: 1 }, { suit: "diamonds", rank: 3 }, null, null],
  foundations: {
    spades: [],
    hearts: [
      { suit: "hearts", rank: 1 },
      { suit: "hearts", rank: 2 },
    ],
    diamonds: [],
    clubs: [],
  },
  undoStack: [],
  isComplete: false,
  moveCount: 0,
};

const CARD: DragCard = { suit: "hearts", rank: 3, width: 60, height: 90 };

const fromTableau = (col: number, fromIndex = 0): DragSource => ({
  game: "freecell",
  type: "tableau",
  col,
  fromIndex,
});
const fromCell = (cell: number): DragSource => ({ game: "freecell", type: "freecell", cell });
const fromFoundation = (suit: Suit): DragSource => ({
  game: "freecell",
  type: "foundation",
  suit,
});

async function renderBoard(props: { inputLocked?: boolean } = {}, state = STATE) {
  const onMove = jest.fn();
  const ui = (locked?: boolean) => (
    <ThemeProvider>
      <FreeCellBoard state={state} onMove={onMove} inputLocked={locked} />
    </ThemeProvider>
  );
  await render(ui(props.inputLocked));
  return { onMove, setLocked: (locked: boolean) => screen.rerender(ui(locked)) };
}

const drop = (zoneId: string, source: DragSource, cards: DragCard[] = [CARD]) =>
  dropOn(mockDrops, zoneId, source, cards);

/** Starts a drag and returns the ids of the targets the board lights up for it. */
const legalTargets = (source: DragSource, cards: DragCard[] = [CARD]) =>
  legalTargetsOf(mockDrops, source, cards);

beforeEach(() => {
  resetDropSink(mockDrops);
});

describe("FreeCellBoard — drop on a tableau column", () => {
  it("moves a tableau card onto a legal column", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-tableau-1", fromTableau(0))).toBe(true);
    expect(onMove).toHaveBeenCalledWith({
      type: "tableau-to-tableau",
      fromCol: 0,
      fromIndex: 0,
      toCol: 1,
    });
  });

  it("rejects a tableau card dropped on an illegal column", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-tableau-3", fromTableau(0))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("moves a free-cell card onto a legal column", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-tableau-1", fromCell(1))).toBe(true);
    expect(onMove).toHaveBeenCalledWith({ type: "freecell-to-tableau", fromCell: 1, toCol: 1 });
  });

  it("rejects a free-cell card dropped on an illegal column", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-tableau-1", fromCell(0))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("moves a foundation card back onto a legal column", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-tableau-6", fromFoundation("hearts"))).toBe(true);
    expect(onMove).toHaveBeenCalledWith({
      type: "foundation-to-tableau",
      fromSuit: "hearts",
      toCol: 6,
    });
  });

  it("rejects a foundation card dropped on an illegal column", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-tableau-1", fromFoundation("hearts"))).toBe(false);
    expect(await drop("freecell-tableau-1", fromFoundation("spades"))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("rejects a drag from another game", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-tableau-1", { game: "solitaire", type: "waste" })).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("rejects every drop while input is locked", async () => {
    const { onMove } = await renderBoard({ inputLocked: true });
    expect(await drop("freecell-tableau-1", fromTableau(0))).toBe(false);
    expect(await drop("freecell-tableau-1", fromCell(1))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("accepts drops again once input is unlocked", async () => {
    const { onMove, setLocked } = await renderBoard({ inputLocked: true });
    await setLocked(false);
    expect(await drop("freecell-tableau-1", fromTableau(0))).toBe(true);
    expect(onMove).toHaveBeenCalledTimes(1);
  });
});

describe("FreeCellBoard — drop on a foundation", () => {
  it("sends a tableau card to its foundation", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-foundation-hearts", fromTableau(0))).toBe(true);
    expect(onMove).toHaveBeenCalledWith({ type: "tableau-to-foundation", fromCol: 0 });
  });

  it("sends a free-cell card to its foundation", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-foundation-spades", fromCell(0))).toBe(true);
    expect(onMove).toHaveBeenCalledWith({ type: "freecell-to-foundation", fromCell: 0 });
  });

  it("rejects a card that is not next in its suit", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-foundation-clubs", fromTableau(1))).toBe(false);
    expect(await drop("freecell-foundation-diamonds", fromCell(1))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("rejects a card dragged from a foundation, another game, or while locked", async () => {
    const { onMove, setLocked } = await renderBoard();
    expect(await drop("freecell-foundation-hearts", fromFoundation("hearts"))).toBe(false);
    expect(await drop("freecell-foundation-hearts", { game: "solitaire", type: "waste" })).toBe(
      false
    );
    await setLocked(true);
    expect(await drop("freecell-foundation-hearts", fromTableau(0))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("FreeCellBoard — drop on a free cell", () => {
  it("parks a tableau card in an empty cell", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-slot-2", fromTableau(0))).toBe(true);
    expect(onMove).toHaveBeenCalledWith({ type: "tableau-to-freecell", fromCol: 0, toCell: 2 });
  });

  it("rejects an occupied cell", async () => {
    const { onMove } = await renderBoard();
    expect(await drop("freecell-slot-0", fromTableau(0))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });

  it("only takes cards dragged from the tableau, in this game, while unlocked", async () => {
    const { onMove, setLocked } = await renderBoard();
    expect(await drop("freecell-slot-2", fromCell(1))).toBe(false);
    expect(await drop("freecell-slot-2", fromFoundation("hearts"))).toBe(false);
    expect(await drop("freecell-slot-2", { game: "solitaire", type: "waste" })).toBe(false);
    await setLocked(true);
    expect(await drop("freecell-slot-2", fromTableau(0))).toBe(false);
    expect(onMove).not.toHaveBeenCalled();
  });
});

describe("FreeCellBoard — legal targets while dragging", () => {
  it("lights the columns, free cells and foundations a tableau card can go to", async () => {
    await renderBoard();
    expect(await legalTargets(fromTableau(0))).toEqual([
      "freecell-tableau-1",
      "freecell-tableau-2",
      "freecell-slot-2",
      "freecell-slot-3",
      "freecell-foundation-spades",
      "freecell-foundation-hearts",
      "freecell-foundation-diamonds",
      "freecell-foundation-clubs",
    ]);
  });

  it("offers no cell or foundation for a multi-card run", async () => {
    await renderBoard();
    const ids = await legalTargets(fromTableau(0), [CARD, CARD]);
    expect(ids).toEqual(["freecell-tableau-1", "freecell-tableau-2"]);
  });

  it("lights the empty columns, and the free cells, for a king", async () => {
    await renderBoard();
    expect(await legalTargets(fromTableau(5))).toEqual([
      "freecell-tableau-4",
      "freecell-tableau-7",
      "freecell-slot-2",
      "freecell-slot-3",
    ]);
  });

  it("lights only the foundations for a free-cell ace that fits no column", async () => {
    await renderBoard();
    expect(await legalTargets(fromCell(0))).toEqual([
      "freecell-foundation-spades",
      "freecell-foundation-hearts",
      "freecell-foundation-diamonds",
      "freecell-foundation-clubs",
    ]);
  });

  it("lights only the columns for a free-cell card that is not next on its foundation", async () => {
    await renderBoard();
    expect(await legalTargets(fromCell(1))).toEqual(["freecell-tableau-1", "freecell-tableau-2"]);
  });

  it("lights the columns a foundation card can return to", async () => {
    await renderBoard();
    expect(await legalTargets(fromFoundation("hearts"))).toEqual(["freecell-tableau-6"]);
  });

  it("lights nothing for a drag from another game or while locked", async () => {
    const { setLocked } = await renderBoard();
    expect(await legalTargets({ game: "solitaire", type: "waste" })).toEqual([]);
    await setLocked(true);
    expect(await legalTargets(fromTableau(0))).toEqual([]);
  });
});
