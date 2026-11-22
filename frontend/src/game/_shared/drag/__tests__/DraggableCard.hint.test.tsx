import React from "react";
import { Text } from "react-native";
import { render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DraggableCard } from "../DraggableCard";

const dragCards: DragCard[] = [{ suit: "spades", rank: 1, faceDown: false, width: 60, height: 90 }];
const dragSource: DragSource = { game: "solitaire", type: "foundation", suit: "spades" };

const wrap = (children: React.ReactNode) => (
  <DragProvider>
    <ThemeProvider>{children}</ThemeProvider>
  </DragProvider>
);

// The accessibility wiring is gated off under NODE_ENV === "test" (see DraggableCard.tsx), so
// these force the production path, as DraggableCard.test.tsx does.
describe("DraggableCard accessibilityHint (#3606)", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  beforeEach(() => {
    process.env.NODE_ENV = "production";
  });
  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
  });

  it("puts the hint on the element that carries `accessible`", async () => {
    const { getByTestId } = await render(
      wrap(
        <DraggableCard
          testID="card"
          onTap={jest.fn()}
          accessibilityLabel="A of Spades"
          accessibilityHint="Can move here"
          dragCards={dragCards}
          dragSource={dragSource}
        >
          <Text>A</Text>
        </DraggableCard>
      )
    );
    const card = getByTestId("card");
    expect(card.props.accessible).toBe(true);
    expect(card.props.accessibilityHint).toBe("Can move here");
  });

  it("drops the hint when the card is not accessible (no label), so it is never announced twice", async () => {
    const { getByTestId } = await render(
      wrap(
        <DraggableCard
          testID="card"
          onTap={jest.fn()}
          accessibilityHint="Can move here"
          dragCards={dragCards}
          dragSource={dragSource}
        >
          <Text>A</Text>
        </DraggableCard>
      )
    );
    expect(getByTestId("card").props.accessible).toBe(false);
    expect(getByTestId("card").props.accessibilityHint).toBeUndefined();
  });

  it("has no hint unless one is given", async () => {
    const { getByTestId } = await render(
      wrap(
        <DraggableCard
          testID="card"
          onTap={jest.fn()}
          accessibilityLabel="A of Spades"
          dragCards={dragCards}
          dragSource={dragSource}
        >
          <Text>A</Text>
        </DraggableCard>
      )
    );
    expect(getByTestId("card").props.accessibilityHint).toBeUndefined();
  });
});
