import React from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DragOverlay } from "../DragOverlay";

const dragCards: DragCard[] = [{ suit: "spades", rank: 1, faceDown: false, width: 60, height: 90 }];
const dragSource: DragSource = { game: "solitaire", type: "waste" };

function DragStarter() {
  const { startDrag } = useDragContext();
  return (
    <Text accessibilityLabel="start" onPress={() => startDrag(dragSource, dragCards)}>
      start
    </Text>
  );
}

function wrap(children: React.ReactNode) {
  return (
    <DragProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </DragProvider>
  );
}

describe("DragOverlay", () => {
  it("renders nothing when no drag is active", () => {
    const { queryByTestId } = render(wrap(<DragOverlay />));
    expect(queryByTestId("drag-overlay-ghost")).toBeNull();
  });

  it("lifts the ghost 8pt above the card position (translateY = cardY - 8)", () => {
    const { getByLabelText, getByTestId } = render(
      wrap(
        <>
          <DragStarter />
          <DragOverlay />
        </>
      )
    );

    fireEvent.press(getByLabelText("start"));

    const ghost = getByTestId("drag-overlay-ghost");
    // useAnimatedStyle mock calls fn() immediately; cardY starts at 0, so translateY = 0 - 8 = -8.
    const flatStyle = [ghost.props.style].flat().filter(Boolean);
    const merged = Object.assign({}, ...flatStyle);
    const transforms = merged.transform as Array<Record<string, number>>;
    expect(transforms).toContainEqual({ translateY: -8 });
  });
});
