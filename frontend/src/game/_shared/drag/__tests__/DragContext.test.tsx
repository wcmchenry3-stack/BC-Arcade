import React from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";

const dragCards: DragCard[] = [{ suit: "hearts", rank: 5, faceDown: false, width: 60, height: 90 }];
const dragSource: DragSource = { game: "solitaire", type: "waste" };

function wrap(children: React.ReactNode) {
  return (
    <DragProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </DragProvider>
  );
}

function SnapBackTrigger() {
  const { startDrag, snapBackAndClear } = useDragContext();
  return (
    <>
      <Text accessibilityLabel="start" onPress={() => startDrag(dragSource, dragCards)}>
        start
      </Text>
      <Text accessibilityLabel="snap" onPress={() => snapBackAndClear()}>
        snap
      </Text>
    </>
  );
}

function DropZoneRegistrar({
  id,
  onRefresh,
}: {
  id: string;
  onRefresh: () => void;
}) {
  const { registerDropZone, unregisterDropZone } = useDragContext();
  React.useEffect(() => {
    registerDropZone(id, {
      getMeasurement: () => null,
      refreshMeasurement: onRefresh,
      onDrop: () => false,
    });
    return () => unregisterDropZone(id);
  }, [id, onRefresh, registerDropZone, unregisterDropZone]);
  return null;
}

function StartDragTrigger() {
  const { startDrag } = useDragContext();
  return (
    <Text accessibilityLabel="start" onPress={() => startDrag(dragSource, dragCards)}>
      start
    </Text>
  );
}

describe("DragContext", () => {
  it("snapBackAndClear calls withSpring for the animation", () => {
    const withSpring = jest.spyOn(Reanimated, "withSpring");

    const { getByLabelText } = render(wrap(<SnapBackTrigger />));
    fireEvent.press(getByLabelText("start"));
    fireEvent.press(getByLabelText("snap"));

    expect(withSpring).toHaveBeenCalled();
    withSpring.mockRestore();
  });

  it("startDrag calls refreshMeasurement on every registered drop zone", () => {
    const refresh1 = jest.fn();
    const refresh2 = jest.fn();

    const { getByLabelText } = render(
      <DragProvider>
        <ThemeProvider>
          <DropZoneRegistrar id="zone-a" onRefresh={refresh1} />
          <DropZoneRegistrar id="zone-b" onRefresh={refresh2} />
          <StartDragTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    fireEvent.press(getByLabelText("start"));

    expect(refresh1).toHaveBeenCalledTimes(1);
    expect(refresh2).toHaveBeenCalledTimes(1);
  });
});
