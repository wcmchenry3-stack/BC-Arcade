import React from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DraggableCard } from "../DraggableCard";

const dragCards: DragCard[] = [{ suit: "spades", rank: 1, faceDown: false, width: 60, height: 90 }];
const dragSource: DragSource = {
  game: "solitaire",
  type: "tableau",
  col: 0,
  fromIndex: 0,
};

function wrap(children: React.ReactNode) {
  return (
    <DragProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </DragProvider>
  );
}

/** Renders a button that calls startDrag for the given source/cards. */
function DragTrigger({ source, cards }: { source: DragSource; cards: DragCard[] }) {
  const { startDrag } = useDragContext();
  return (
    <Text
      accessibilityRole="button"
      accessibilityLabel="trigger"
      onPress={() => startDrag(source, cards)}
    >
      Trigger
    </Text>
  );
}

describe("DraggableCard", () => {
  it("fires onTap when a draggable card is pressed", () => {
    const onTap = jest.fn();
    const { getByRole } = render(
      wrap(
        <DraggableCard onTap={onTap} dragCards={dragCards} dragSource={dragSource}>
          <Text accessibilityRole="button">A♠</Text>
        </DraggableCard>
      )
    );
    fireEvent.press(getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("fires onTap exactly once per press — not double-fired via both gesture and onPress", () => {
    // Regression: the old Simultaneous composition wired onTap to both the RNGH
    // tap gesture (runOnJS) and the native onPress clone, risking two calls per touch.
    const onTap = jest.fn();
    const { getByRole } = render(
      wrap(
        <DraggableCard onTap={onTap} dragCards={dragCards} dragSource={dragSource}>
          <Text accessibilityRole="button">A♠</Text>
        </DraggableCard>
      )
    );
    fireEvent.press(getByRole("button"));
    fireEvent.press(getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it("fires onTap when a non-draggable card is pressed", () => {
    const onTap = jest.fn();
    const { getByRole } = render(
      wrap(
        <DraggableCard
          onTap={onTap}
          dragCards={dragCards}
          dragSource={dragSource}
          draggable={false}
        >
          <Text accessibilityRole="button">K♦</Text>
        </DraggableCard>
      )
    );
    fireEvent.press(getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("does not fire onTap when draggable=false and no onTap is provided", () => {
    const { getByText } = render(
      wrap(
        <DraggableCard dragCards={dragCards} dragSource={dragSource} draggable={false}>
          <Text>A♠</Text>
        </DraggableCard>
      )
    );
    expect(getByText("A♠")).toBeTruthy();
  });

  it("does not throw when pressed with no onTap prop", () => {
    const { getByRole } = render(
      wrap(
        <DraggableCard dragCards={dragCards} dragSource={dragSource}>
          <Text accessibilityRole="button">A♠</Text>
        </DraggableCard>
      )
    );
    expect(() => fireEvent.press(getByRole("button"))).not.toThrow();
  });

  it("dims the card (opacity 0.6) while it is the active drag source", () => {
    const { getByLabelText, getByTestId } = render(
      <DragProvider>
        <ThemeProvider>
          <DragTrigger source={dragSource} cards={dragCards} />
          <DraggableCard testID="card" dragCards={dragCards} dragSource={dragSource}>
            <Text>A♠</Text>
          </DraggableCard>
        </ThemeProvider>
      </DragProvider>
    );

    expect(getByTestId("card")).toHaveStyle({ opacity: 1 });
    fireEvent.press(getByLabelText("trigger"));
    expect(getByTestId("card")).toHaveStyle({ opacity: 0.6 });
  });

  it("accepts hitSlop prop without throwing", () => {
    const { getByTestId } = render(
      wrap(
        <DraggableCard
          testID="card"
          dragCards={dragCards}
          dragSource={dragSource}
          hitSlop={{ bottom: 28 }}
        >
          <Text>A♠</Text>
        </DraggableCard>
      )
    );
    expect(getByTestId("card")).toBeTruthy();
  });
});
