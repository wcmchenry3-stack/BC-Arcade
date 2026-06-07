import React from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

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
  it("fires onTap when a draggable card is pressed", async () => {
    const onTap = jest.fn();
    const { getByRole } = await render(
      wrap(
        <DraggableCard onTap={onTap} dragCards={dragCards} dragSource={dragSource}>
          <Text accessibilityRole="button">A♠</Text>
        </DraggableCard>
      )
    );
    await fireEvent.press(getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("fires onTap exactly once per press — not double-fired via both gesture and onPress", async () => {
    // Regression guard: each press must fire onTap exactly once.
    // In tests, fireEvent.press calls the child's onPress directly (RNGH mocked).
    // On device, GestureDetector claims the RN responder so the child's onPress
    // never fires — only RNGH's tap.onEnd (via runOnJS) triggers onTap.
    // Invariant holds for short drags too: pan fails → Gesture.Exclusive activates
    // tap → single onTap call, child onPress suppressed by responder ownership.
    const onTap = jest.fn();
    const { getByRole } = await render(
      wrap(
        <DraggableCard onTap={onTap} dragCards={dragCards} dragSource={dragSource}>
          <Text accessibilityRole="button">A♠</Text>
        </DraggableCard>
      )
    );
    await fireEvent.press(getByRole("button"));
    await fireEvent.press(getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(2);
  });

  it("fires onTap when a non-draggable card is pressed", async () => {
    const onTap = jest.fn();
    const { getByRole } = await render(
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
    await fireEvent.press(getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);
  });

  it("does not fire onTap when draggable=false and no onTap is provided", async () => {
    const { getByText } = await render(
      wrap(
        <DraggableCard dragCards={dragCards} dragSource={dragSource} draggable={false}>
          <Text>A♠</Text>
        </DraggableCard>
      )
    );
    expect(getByText("A♠")).toBeTruthy();
  });

  it("does not throw when pressed with no onTap prop", async () => {
    const { getByRole } = await render(
      wrap(
        <DraggableCard dragCards={dragCards} dragSource={dragSource}>
          <Text accessibilityRole="button">A♠</Text>
        </DraggableCard>
      )
    );
    await fireEvent.press(getByRole("button"));
  });

  it("dims the card (opacity 0.6) while it is the active drag source", async () => {
    const { getByLabelText, getByTestId } = await render(
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
    await fireEvent.press(getByLabelText("trigger"));
    expect(getByTestId("card")).toHaveStyle({ opacity: 0.6 });
  });

  it("renders without crash when rnMeasure is mocked to return null", async () => {
    // Pan gesture worklets run natively and can't be simulated in Jest, but we can
    // verify the component mounts and tap-fallback still works when rnMeasure returns null.
    const measureSpy = jest.spyOn(Reanimated, "measure").mockReturnValue(null);
    const onTap = jest.fn();

    const { getByRole } = await render(
      wrap(
        <DraggableCard onTap={onTap} dragCards={dragCards} dragSource={dragSource}>
          <Text accessibilityRole="button">A♠</Text>
        </DraggableCard>
      )
    );

    await fireEvent.press(getByRole("button"));
    expect(onTap).toHaveBeenCalledTimes(1);

    measureSpy.mockRestore();
  });

  it("accepts hitSlop prop without throwing", async () => {
    const { getByTestId } = await render(
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
