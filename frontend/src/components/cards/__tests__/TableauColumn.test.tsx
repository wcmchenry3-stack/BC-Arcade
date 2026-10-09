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
      { suit: "hearts", rank: 8, faceDown: false, width: 52, height: 74 },
      { suit: "clubs", rank: 7, faceDown: false, width: 52, height: 74 },
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

  it("an empty column: dashed placeholder with FreeCell's 6-px radius and 2-px hint border", async () => {
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
      borderWidth: 2,
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
      { suit: "spades", rank: 13, faceDown: true, width: 52, height: 74 },
      { suit: "hearts", rank: 7, faceDown: false, width: 52, height: 74 },
      { suit: "clubs", rank: 6, faceDown: false, width: 52, height: 74 },
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
