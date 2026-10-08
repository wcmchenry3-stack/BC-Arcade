/**
 * #2983: the shared foundation pile, through its FreeCell and Solitaire wrappers. As in the
 * tableau test, `DraggableCard` and `DropTarget` are recorders, so the drag contract (source,
 * dragged card, testIDs, drop-zone styles) is read from the props the pile hands them.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";

import { ThemeProvider, dark } from "../../../theme/ThemeContext";
import { CardSizeContext } from "../../../game/_shared/CardSizeContext";
import FreeCellFoundationPile from "../../freecell/FoundationPile";
import SolitaireFoundationPile from "../../solitaire/FoundationPile";
import type { Card as SolitaireCard } from "../../../game/solitaire/types";

type Recorded = Record<string, unknown>;
const mockDraggables = new Map<string, Recorded>();
const mockDropTargets = new Map<string, Recorded>();

jest.mock("../../../game/_shared/drag/DraggableCard", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    DraggableCard: (props: { testID: string; children?: unknown }) => {
      mockDraggables.set(props.testID, props);
      return createElement(View, { testID: props.testID }, props.children);
    },
  };
});

jest.mock("../../../game/_shared/drag/DropTarget", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  return {
    DropTarget: (props: { id: string; testID?: string; children?: unknown }) => {
      mockDropTargets.set(props.id, props);
      return createElement(View, { testID: props.testID }, props.children);
    },
  };
});

async function draw(node: React.ReactElement) {
  mockDraggables.clear();
  mockDropTargets.clear();
  await render(
    <ThemeProvider>
      <CardSizeContext.Provider value={{ cardWidth: 52, cardHeight: 74 }}>
        {node}
      </CardSizeContext.Provider>
    </ThemeProvider>
  );
}

const flat = (label: string | RegExp) =>
  StyleSheet.flatten(screen.getByLabelText(label).props.style);
const glyph = (text: string) => StyleSheet.flatten(screen.getByText(text).props.style);

const hearts = (rank: number) => ({ suit: "hearts" as const, rank: rank as SolitaireCard["rank"] });

describe("FoundationPile via FreeCell", () => {
  it("empty: an 18-px, 75%-opacity glyph — red suits in the card red, black in textFilled", async () => {
    await draw(<FreeCellFoundationPile pile={[]} suit="hearts" />);
    expect(glyph("♥")).toMatchObject({
      fontSize: 18,
      lineHeight: 22,
      opacity: 0.75,
      color: dark.cardRedSuit,
    });
    expect(flat("Empty Hearts foundation")).toMatchObject({ borderRadius: 6, borderWidth: 1 });

    await draw(<FreeCellFoundationPile pile={[]} suit="spades" />);
    expect(glyph("♠").color).toBe(dark.textFilled);
  });

  it("empty and hinted: a 2-px bonus border", async () => {
    await draw(<FreeCellFoundationPile pile={[]} suit="clubs" hintDestination />);
    expect(flat("Empty Clubs foundation")).toMatchObject({
      borderWidth: 2,
      borderColor: dark.bonus,
    });
  });

  it("the top card drags from the foundation under FreeCell's testID and labels", async () => {
    await draw(
      <FreeCellFoundationPile
        pile={[hearts(1), hearts(2)]}
        suit="hearts"
        selected
        dropId="freecell-foundation-hearts"
        onDrop={() => true}
      />
    );
    const card = mockDraggables.get("freecell-foundation-hearts-card")!;
    expect(card.dragSource).toEqual({ game: "freecell", type: "foundation", suit: "hearts" });
    expect(card.dragCards).toEqual([
      { suit: "hearts", rank: 2, faceDown: false, width: 52, height: 74 },
    ]);
    expect(card.accessibilityLabel).toBe("2 of Hearts (selected)");
    expect(mockDropTargets.get("freecell-foundation-hearts")).toMatchObject({
      testID: "freecell-foundation-hearts",
      highlightStyle: { borderColor: dark.accent, borderWidth: 2, borderRadius: 6 },
      dimStyle: { opacity: 0.4 },
    });
  });
});

describe("FoundationPile via Solitaire", () => {
  it("empty: a 32-px glyph in textMuted for every suit, 8-px radius", async () => {
    await draw(<SolitaireFoundationPile pile={[]} suit="diamonds" />);
    expect(glyph("♦")).toMatchObject({ fontSize: 32, lineHeight: 36, color: dark.textMuted });
    expect(glyph("♦").opacity).toBeUndefined();
    expect(flat("Empty Diamonds foundation")).toMatchObject({ borderRadius: 8 });
  });

  it("empty and the hint source: a 3-px bonus border", async () => {
    await draw(<SolitaireFoundationPile pile={[]} suit="spades" hintSource />);
    expect(flat("Empty Spades foundation")).toMatchObject({
      borderWidth: 3,
      borderColor: dark.bonus,
    });
  });

  it("a hinted top card sits in a 3-px bonus frame; Solitaire's testID, source and label", async () => {
    await draw(
      <SolitaireFoundationPile
        pile={[{ ...hearts(5), faceUp: true }]}
        suit="hearts"
        hintDestination
        dropId="solitaire-foundation-hearts"
        onDrop={() => true}
      />
    );
    const card = mockDraggables.get("solitaire-foundation-hearts-card")!;
    expect(card.dragSource).toEqual({ game: "solitaire", type: "foundation", suit: "hearts" });
    expect(card.accessibilityLabel).toBe("5 of Hearts");
    const frame = screen.getByTestId("solitaire-foundation-hearts-card").parent!;
    expect(StyleSheet.flatten(frame.props.style)).toMatchObject({
      borderColor: dark.bonus,
      borderWidth: 3,
      borderRadius: 8,
    });
    expect(mockDropTargets.get("solitaire-foundation-hearts")).toMatchObject({
      highlightStyle: { borderColor: dark.accent, borderWidth: 2, borderRadius: 8 },
    });
  });
});
