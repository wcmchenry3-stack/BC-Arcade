/**
 * #2983: the shared tableau column, through its FreeCell and Solitaire wrappers and directly.
 *
 * Gestures can't run in Jest, so `DraggableCard` and `DropTarget` are replaced by recorders that
 * keep the props each card / column hands the drag system — the drag source, the dragged run,
 * `draggable`, `hitSlop`, testIDs and the drop-zone styles. Those props are the whole drag
 * contract of a pile; the device checklist covers what the gesture does with them.
 */
import React from "react";
import { StyleSheet, Text } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { ThemeProvider, dark } from "../../../theme/ThemeContext";
import { CardSizeContext } from "../../../game/_shared/CardSizeContext";
import SharedTableauColumn from "../TableauColumn";
import FreeCellTableauColumn from "../../freecell/TableauColumn";
import SolitaireTableauPile, { computeTableauOffsets } from "../../solitaire/TableauPile";
import type { Card as SolitaireCard } from "../../../game/solitaire/types";
import type { Card as FreeCellCard } from "../../../game/freecell/types";
import type { PileCard } from "../pileTypes";
import { HINT_DEST_OUTSET, HINT_SOURCE_OUTSET } from "../HintFrame";
import { MIN_CARD_W } from "../../../game/_shared/CardSizeContext";
import { compactMinimalLayout } from "../../../game/_shared/decks/cornerIndex";

type Recorded = Record<string, unknown>;
const mockDraggables = new Map<string, Recorded>();
const mockDropTargets = new Map<string, Recorded>();

jest.mock("../../../game/_shared/drag/DraggableCard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    DraggableCard: (props: { testID: string; style?: unknown; children?: unknown }) => {
      mockDraggables.set(props.testID, props);
      return createElement(View, { testID: props.testID, style: props.style }, props.children);
    },
  };
});

jest.mock("../../../game/_shared/drag/DropTarget", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    DropTarget: (props: { id: string; testID?: string; style?: unknown; children?: unknown }) => {
      mockDropTargets.set(props.id, props);
      return createElement(View, { testID: props.testID, style: props.style }, props.children);
    },
  };
});

const SIZE = { cardWidth: 52, cardHeight: 74 };

async function draw(node: React.ReactElement) {
  mockDraggables.clear();
  mockDropTargets.clear();
  await render(
    <ThemeProvider>
      <CardSizeContext.Provider value={SIZE}>{node}</CardSizeContext.Provider>
    </ThemeProvider>
  );
}

const drag = (testID: string): Recorded => {
  const props = mockDraggables.get(testID);
  if (!props) throw new Error(`no DraggableCard ${testID}`);
  return props;
};
const top = (testID: string) => StyleSheet.flatten(screen.getByTestId(testID).props.style).top;

const fc = (suit: FreeCellCard["suit"], rank: number): FreeCellCard => ({
  suit,
  rank: rank as FreeCellCard["rank"],
});
const sol = (suit: SolitaireCard["suit"], rank: number, faceUp = true): SolitaireCard => ({
  suit,
  rank: rank as SolitaireCard["rank"],
  faceUp,
});

describe("TableauColumn via FreeCell", () => {
  const pile = [fc("spades", 9), fc("hearts", 8), fc("clubs", 7)];

  it("keeps FreeCell's testIDs and drag sources, carrying the run from each card up", async () => {
    await draw(
      <FreeCellTableauColumn pile={pile} colIndex={3} dropId="freecell-col-3" onDrop={() => true} />
    );
    expect(drag("freecell-col-3-card-0").dragSource).toEqual({
      game: "freecell",
      type: "tableau",
      col: 3,
      fromIndex: 0,
    });
    expect(drag("freecell-col-3-card-1").dragCards).toEqual([
      { suit: "hearts", rank: 8, faceDown: false, width: 52, height: 74, stackTop: 0 },
      { suit: "clubs", rank: 7, faceDown: false, width: 52, height: 74, stackTop: 47 },
    ]);
    expect(drag("freecell-col-3-top").dragSource).toMatchObject({ fromIndex: 2 });
    for (const id of ["freecell-col-3-card-0", "freecell-col-3-card-1", "freecell-col-3-top"]) {
      expect(drag(id).draggable).toBe(true);
    }
  });

  it("stretches buried cards' hit area over their stripe; the top card has none", async () => {
    // 40-px natural FreeCell card scaled to 52: offset round(36 * 1.3) = 47.
    await draw(<FreeCellTableauColumn pile={pile} colIndex={0} />);
    expect(drag("freecell-col-0-card-0").hitSlop).toEqual({
      top: 0,
      bottom: 24,
      left: 4,
      right: 4,
    });
    expect(drag("freecell-col-0-top").hitSlop).toBeUndefined();
    expect([0, 1].map((i) => top(`freecell-col-0-card-${i}`))).toEqual([0, 47]);
    expect(top("freecell-col-0-top")).toBe(94);
  });

  it("a hinted run (#3346) is ONE source frame from its first card to the column bottom", async () => {
    await draw(<FreeCellTableauColumn pile={pile} colIndex={0} hintIndex={1} />);
    const frames = screen.getAllByTestId("hint-frame-source");
    expect(frames).toHaveLength(1);
    // Card 1 starts at 47 (52-wide card, 1.3 scale); the frame sits 1 px outside the card edge.
    expect(StyleSheet.flatten(frames[0]!.props.style)).toMatchObject({
      top: 47 - HINT_SOURCE_OUTSET,
      bottom: -HINT_SOURCE_OUTSET,
      left: -HINT_SOURCE_OUTSET,
      right: -HINT_SOURCE_OUTSET,
    });
    expect(screen.queryByTestId("hint-frame-destination")).toBeNull();
  });

  it("a hinted destination on a non-empty column frames only the top card, dashed", async () => {
    await draw(<FreeCellTableauColumn pile={pile} colIndex={0} hintDestination />);
    const frame = StyleSheet.flatten(screen.getByTestId("hint-frame-destination").props.style);
    expect(frame).toMatchObject({
      top: 94 - HINT_DEST_OUTSET,
      borderStyle: "dashed",
      borderWidth: 4,
    });
    expect(screen.queryByTestId("hint-frame-source")).toBeNull();
  });

  it("at the smallest card (MIN_CARD_W) the run frame spans the run and stays off the index", async () => {
    const h = Math.round((MIN_CARD_W * 74) / 52);
    await render(
      <ThemeProvider>
        <CardSizeContext.Provider value={{ cardWidth: MIN_CARD_W, cardHeight: h }}>
          <FreeCellTableauColumn pile={pile} colIndex={0} hintIndex={0} hintDestination />
        </CardSizeContext.Provider>
      </ThemeProvider>
    );
    const src = StyleSheet.flatten(screen.getByTestId("hint-frame-source").props.style);
    expect(src.top).toBe(-HINT_SOURCE_OUTSET);
    // Index (rank at x=5, y=2 on a 36-px card): neither border may reach into it.
    const reach = (b: number, o: number) => b - o;
    expect(reach(src.borderWidth, HINT_SOURCE_OUTSET)).toBeLessThanOrEqual(2);
    const dst = StyleSheet.flatten(screen.getByTestId("hint-frame-destination").props.style);
    expect(reach(dst.borderWidth, HINT_DEST_OUTSET)).toBeLessThanOrEqual(2);
    expect(dst.top).toBeGreaterThan(src.top);
  });

  it("no hint: no frames", async () => {
    await draw(<FreeCellTableauColumn pile={pile} colIndex={0} />);
    expect(screen.queryByTestId("hint-frame-source")).toBeNull();
    expect(screen.queryByTestId("hint-frame-destination")).toBeNull();
  });

  it("an empty column: dashed placeholder with FreeCell's 6-px radius and 4-px hint border (#3346)", async () => {
    await draw(
      <FreeCellTableauColumn
        pile={[]}
        colIndex={1}
        hintDestination
        dropId="freecell-col-1"
        onDrop={() => true}
      />
    );
    const style = StyleSheet.flatten(screen.getByLabelText("Empty tableau column 2").props.style);
    expect(style).toMatchObject({
      borderRadius: 6,
      borderStyle: "dashed",
      borderWidth: 4,
      borderColor: dark.bonus,
      width: 52,
      height: 74,
    });
    expect(mockDropTargets.get("freecell-col-1")).toMatchObject({
      testID: "freecell-col-1",
      highlightStyle: { borderColor: dark.accent, borderWidth: 2, borderRadius: 6 },
      dimStyle: { opacity: 0.4 },
    });
  });
});

describe("TableauColumn via Solitaire", () => {
  const pile = [sol("spades", 13, false), sol("hearts", 7), sol("clubs", 6)];
  const { faceUpOffset, faceDownOffset } = computeTableauOffsets(52);

  it("stacks face-down cards tighter and never lets them drag", async () => {
    await draw(<SolitaireTableauPile pile={pile} colIndex={2} />);
    expect(top("solitaire-tableau-2-card-1")).toBe(faceDownOffset);
    expect(top("solitaire-tableau-2-card-2")).toBe(faceDownOffset + faceUpOffset);
    expect(drag("solitaire-tableau-2-card-0").draggable).toBe(false);
    expect(drag("solitaire-tableau-2-card-1").draggable).toBe(true);
    expect(drag("solitaire-tableau-2-card-0").dragCards).toEqual([
      { suit: "spades", rank: 13, faceDown: true, width: 52, height: 74, stackTop: 0 },
      {
        suit: "hearts",
        rank: 7,
        faceDown: false,
        width: 52,
        height: 74,
        stackTop: faceDownOffset,
      },
      {
        suit: "clubs",
        rank: 6,
        faceDown: false,
        width: 52,
        height: 74,
        stackTop: faceDownOffset + faceUpOffset,
      },
    ]);
    expect(drag("solitaire-tableau-2-card-0").hitSlop).toEqual({
      top: 0,
      bottom: Math.min(24, faceDownOffset),
      left: 4,
      right: 4,
    });
    expect(drag("solitaire-tableau-2-card-1").dragSource).toEqual({
      game: "solitaire",
      type: "tableau",
      col: 2,
      fromIndex: 1,
    });
  });

  it("frames the hint-source card (3-px bonus border) under the hint testID", async () => {
    await draw(<SolitaireTableauPile pile={pile} colIndex={0} hintIndex={1} />);
    const style = StyleSheet.flatten(screen.getByTestId("solitaire-hint-source").props.style);
    expect(style).toMatchObject({ borderColor: dark.bonus, borderWidth: 3, borderRadius: 8 });
    expect(screen.queryByTestId("solitaire-tableau-0-card-1")).toBeNull();
    const plain = StyleSheet.flatten(screen.getByTestId("solitaire-tableau-0-card-2").props.style);
    expect(plain.borderWidth).toBeUndefined();
  });

  it("an empty column: Solitaire's 8-px radius and 3-px hint border", async () => {
    await draw(
      <SolitaireTableauPile
        pile={[]}
        colIndex={0}
        hintDestination
        dropId="solitaire-tableau-0"
        onDrop={() => true}
      />
    );
    const style = StyleSheet.flatten(screen.getByLabelText("Empty tableau column 1").props.style);
    expect(style).toMatchObject({ borderRadius: 8, borderWidth: 3, borderStyle: "dashed" });
    expect(mockDropTargets.get("solitaire-tableau-0")).toMatchObject({
      highlightStyle: { borderColor: dark.accent, borderWidth: 2, borderRadius: 8 },
    });
  });
});

describe("TableauColumn (shared, direct)", () => {
  const pile: PileCard[] = [
    { suit: "spades", rank: 4, faceUp: false },
    { suit: "hearts", rank: 3 },
  ];

  it("uses the face-up offset for face-down cards when no faceDownOffset is given", async () => {
    await draw(
      <SharedTableauColumn
        game="solitaire"
        ns="solitaire"
        emptyRadius={8}
        hintBorderWidth={3}
        faceUpOffset={30}
        cardTestID={(i) => `c-${i}`}
        renderCard={(card) => <Text>{`${card.rank}`}</Text>}
        pile={pile}
        colIndex={0}
        dropId="zone"
        onDrop={() => true}
      />
    );
    expect(top("c-1")).toBe(30);
    expect(screen.getByText("4")).toBeTruthy();
    // The drop zone is sized to the stack: card height plus the last offset.
    expect(mockDropTargets.get("zone")!.style).toEqual({ width: 52, height: 104 });
    expect(screen.getByLabelText("Tableau column 1, 2 cards")).toBeTruthy();
  });
});

describe("drag ghost fan uses the pile's real offsets (#3531)", () => {
  const stackTops = (testID: string) =>
    (drag(testID).dragCards as { stackTop?: number }[]).map((c) => c.stackTop);

  it("Solitaire: a face-up run fans by computeTableauOffsets' face-up offset, at any card size", async () => {
    const pile = [sol("spades", 13, false), sol("hearts", 7), sol("clubs", 6), sol("hearts", 5)];
    for (const cardWidth of [52, MIN_CARD_W, 90]) {
      const { faceUpOffset } = computeTableauOffsets(cardWidth);
      mockDraggables.clear();
      await render(
        <ThemeProvider>
          <CardSizeContext.Provider value={{ cardWidth, cardHeight: Math.round(cardWidth * 1.42) }}>
            <SolitaireTableauPile pile={pile} colIndex={1} />
          </CardSizeContext.Provider>
        </ThemeProvider>
      );
      expect(stackTops("solitaire-tableau-1-card-1")).toEqual([0, faceUpOffset, 2 * faceUpOffset]);
      // The ghost's fan matches the pile as drawn: each card's top minus the run's first.
      const first = top("solitaire-tableau-1-card-1");
      expect(stackTops("solitaire-tableau-1-card-1")).toEqual(
        [1, 2, 3].map((i) => top(`solitaire-tableau-1-card-${i}`) - first)
      );
    }
  });

  it("FreeCell: a compressed column fans by the step the board gives it, not a fixed one", async () => {
    const pile = Array.from({ length: 12 }, (_, i) => fc(i % 2 ? "hearts" : "spades", 13 - i));
    await draw(<FreeCellTableauColumn pile={pile} colIndex={5} faceUpOffset={20} />);
    const tops = Array.from({ length: 11 }, (_, i) => top(`freecell-col-5-card-${i}`));
    const offset = tops[9]! - tops[8]!;
    expect(offset).toBeLessThan(47); // compressed below the full scaled offset
    expect(offset).toBe(20); // exactly the step the board gave it
    expect(stackTops("freecell-col-5-card-8")).toEqual([0, offset, offset * 2, offset * 3]);
  });

  it("a single card carries stackTop 0", async () => {
    await draw(<FreeCellTableauColumn pile={[fc("spades", 1)]} colIndex={0} />);
    expect(stackTops("freecell-col-0-top")).toEqual([0]);
  });
});

describe("compact corner index in a compressed column (#3622)", () => {
  /** The `compactIndex` each card's face was given, by card index. */
  const compactArgs = new Map<number, number | undefined>();
  const renderCard = (card: PileCard, cardIndex: number, _hint?: string, compactIndex?: number) => {
    compactArgs.set(cardIndex, compactIndex);
    return <Text>{`${card.rank}`}</Text>;
  };
  const shared = (pile: PileCard[], faceUpOffset: number, faceDownOffset = 8) => (
    <SharedTableauColumn
      game="solitaire"
      ns="solitaire"
      emptyRadius={8}
      hintBorderWidth={3}
      faceUpOffset={faceUpOffset}
      faceDownOffset={faceDownOffset}
      cardTestID={(i) => `c-${i}`}
      renderCard={renderCard}
      pile={pile}
      colIndex={0}
    />
  );
  const klondike: PileCard[] = [
    { suit: "spades", rank: 9, faceUp: false },
    { suit: "clubs", rank: 2, faceUp: false },
    { suit: "hearts", rank: 13 },
    { suit: "spades", rank: 12 },
    { suit: "diamonds", rank: 11 },
  ];

  beforeEach(() => compactArgs.clear());

  it("covered face-up cards get their stripe; the top card and face-down cards do not", async () => {
    await draw(shared(klondike, 18));
    expect([0, 1, 2, 3, 4].map((i) => compactArgs.get(i))).toEqual([
      undefined,
      undefined,
      18,
      18,
      undefined,
    ]);
    // The drag ghost fans the run with the same offsets, so it draws the same index.
    expect(
      (drag("c-2").dragCards as { compactIndex?: number }[]).map((c) => c.compactIndex)
    ).toEqual([18, 18, undefined]);
  });

  it("picks it from the real stripe: FreeCell's 15 dp step is compact too", async () => {
    await draw(shared([fc("spades", 9), fc("hearts", 8), fc("clubs", 7)], 15));
    expect([0, 1, 2].map((i) => compactArgs.get(i))).toEqual([15, 15, undefined]);
  });

  it("an uncompressed column (a 24 dp stripe or more) keeps the stacked index", async () => {
    for (const step of [24, 30, 53]) {
      compactArgs.clear();
      await draw(shared(klondike, step));
      expect(compactArgs.size).toBe(5);
      expect([...compactArgs.values()].every((v) => v === undefined)).toBe(true);
    }
  });

  it("a fit-floor stripe too short for any compact row keeps the stacked index", async () => {
    for (const step of [1, 3, 9]) {
      compactArgs.clear();
      await draw(shared(klondike, step));
      expect(compactArgs.size).toBe(5);
      expect([...compactArgs.values()].every((v) => v === undefined)).toBe(true);
    }
    compactArgs.clear();
    await draw(shared(klondike, 10));
    expect(compactArgs.get(2)).toBe(10);
  });

  it("reaches the face through the Solitaire and FreeCell wrappers (Minimal deck)", async () => {
    const compactFont = compactMinimalLayout(18).fontSize;
    const fontOf = (text: string) =>
      StyleSheet.flatten(screen.getByText(text).props.style).fontSize;
    await draw(
      <SolitaireTableauPile
        pile={[sol("spades", 9, false), sol("hearts", 13), sol("spades", 12), sol("hearts", 11)]}
        colIndex={0}
        faceUpOffset={18}
        faceDownOffset={8}
        selectedIndex={2}
      />
    );
    expect(fontOf("K")).toBe(compactFont); // covered, unselected (CardView)
    expect(fontOf("Q")).toBe(compactFont); // covered, selected (SelectableCard)
    expect(fontOf("J")).toBe(16); // the top card keeps the full face
    await draw(
      <FreeCellTableauColumn
        pile={[fc("spades", 10), fc("hearts", 9)]}
        colIndex={0}
        faceUpOffset={18}
      />
    );
    expect(fontOf("10")).toBe(compactFont);
    expect(fontOf("9")).toBe(16);
  });
});
