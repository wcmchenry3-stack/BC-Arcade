/**
 * The "Can move here" hint on a legal destination (#3606): it reaches the foundation's
 * top-card DraggableCard, and the tableau's top card, and nowhere else. `DraggableCard` is a
 * recorder (as in TableauColumn.test.tsx), since it is not accessible under NODE_ENV=test; its own
 * production path is covered in DraggableCard.hint.test.tsx.
 */
import React from "react";
import { render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import { CardSizeContext } from "../../../game/_shared/CardSizeContext";
import SolitaireFoundationPile from "../../solitaire/FoundationPile";
import SolitaireTableauPile from "../../solitaire/TableauPile";
import type { Card } from "../../../game/solitaire/types";

const mockDraggables = new Map<string, Record<string, unknown>>();

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
    DropTarget: (props: { testID?: string; children?: unknown }) =>
      createElement(View, { testID: props.testID }, props.children),
  };
});

const up = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank, faceUp: true });
const draw = (node: React.ReactElement) => {
  mockDraggables.clear();
  return render(
    <ThemeProvider>
      <CardSizeContext.Provider value={{ cardWidth: 47, cardHeight: 67 }}>
        {node}
      </CardSizeContext.Provider>
    </ThemeProvider>
  );
};

describe("the target hint reaches the card a screen reader lands on (#3606)", () => {
  it("a legal foundation: on the top card's DraggableCard", async () => {
    await draw(
      <SolitaireFoundationPile
        pile={[up("spades", 1)]}
        suit="spades"
        legalTarget
        dropId="solitaire-foundation-spades"
        onDrop={() => true}
        onPress={jest.fn()}
      />
    );
    expect(mockDraggables.get("solitaire-foundation-spades-card")?.accessibilityHint).toBe(
      "Can move here"
    );
  });

  it("a foundation that is not a target has no hint", async () => {
    await draw(
      <SolitaireFoundationPile
        pile={[up("spades", 1)]}
        suit="spades"
        dropId="solitaire-foundation-spades"
        onDrop={() => true}
        onPress={jest.fn()}
      />
    );
    expect(
      mockDraggables.get("solitaire-foundation-spades-card")?.accessibilityHint
    ).toBeUndefined();
  });

  it("a legal tableau column: the hint is on the card, not on the DraggableCard around it", async () => {
    const { getAllByHintText } = await draw(
      <SolitaireTableauPile
        pile={[up("hearts", 8), up("spades", 7)]}
        colIndex={0}
        legalTarget
        dropId="solitaire-tableau-0"
        onDrop={() => true}
      />
    );
    for (const props of mockDraggables.values()) {
      expect(props.accessibilityHint).toBeUndefined();
    }
    expect(getAllByHintText("Can move here")).toHaveLength(1);
  });
});
