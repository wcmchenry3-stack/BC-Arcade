import React from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DropTarget } from "../DropTarget";

const dragCards: DragCard[] = [{ suit: "clubs", rank: 3, faceDown: false, width: 60, height: 90 }];
const dragSource: DragSource = { game: "solitaire", type: "waste" };

function wrap(
  children: React.ReactNode,
  getLegalDropIds?: (s: DragSource, c: DragCard[]) => string[]
) {
  return (
    <DragProvider getLegalDropIds={getLegalDropIds}>
      <ThemeProvider>{children}</ThemeProvider>
    </DragProvider>
  );
}

function DragTrigger({ source, cards }: { source: DragSource; cards: DragCard[] }) {
  const { startDrag } = useDragContext();
  return (
    <Text accessibilityLabel="trigger" onPress={() => startDrag(source, cards)}>
      Trigger
    </Text>
  );
}

describe("DropTarget", () => {
  it("renders children without highlight when no drag is active", () => {
    const { getByTestId } = render(
      wrap(
        <DropTarget id="pile-1" onDrop={() => false} testID="target">
          <Text>Content</Text>
        </DropTarget>
      )
    );
    expect(getByTestId("target")).not.toHaveStyle({ backgroundColor: expect.anything() });
  });

  it("applies highlight backgroundColor when drag is active and this target is legal", () => {
    const { getByLabelText, getByTestId } = render(
      wrap(
        <>
          <DragTrigger source={dragSource} cards={dragCards} />
          <DropTarget id="pile-1" onDrop={() => false} testID="target">
            <Text>Content</Text>
          </DropTarget>
        </>,
        () => ["pile-1"]
      )
    );

    fireEvent.press(getByLabelText("trigger"));
    const target = getByTestId("target");
    const flatStyle = target.props.style?.flat?.() ?? [target.props.style].flat();
    const merged = Object.assign({}, ...flatStyle.filter(Boolean));
    expect(merged.backgroundColor).toBeDefined();
    expect(merged.backgroundColor).toMatch(/33$/);
  });

  it("applies dimStyle when drag is active and this target is not legal", () => {
    const dimStyle = { opacity: 0.4 };
    const { getByLabelText, getByTestId } = render(
      wrap(
        <>
          <DragTrigger source={dragSource} cards={dragCards} />
          <DropTarget id="pile-2" onDrop={() => false} dimStyle={dimStyle} testID="target">
            <Text>Content</Text>
          </DropTarget>
        </>,
        () => ["pile-1"]
      )
    );

    fireEvent.press(getByLabelText("trigger"));
    expect(getByTestId("target")).toHaveStyle({ opacity: 0.4 });
  });
});
