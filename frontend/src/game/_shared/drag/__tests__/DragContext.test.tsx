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
  onMeasureFresh,
}: {
  id: string;
  onMeasureFresh?: (cb: (bounds: { x: number; y: number; width: number; height: number } | null) => void) => void;
}) {
  const { registerDropZone, unregisterDropZone } = useDragContext();
  React.useEffect(() => {
    registerDropZone(id, {
      measureFresh: onMeasureFresh ?? ((cb) => cb(null)),
      onDrop: () => false,
    });
    return () => unregisterDropZone(id);
  }, [id, onMeasureFresh, registerDropZone, unregisterDropZone]);
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

  it("endDrag calls measureFresh on every registered drop zone", () => {
    const measure1 = jest.fn((cb: (b: null) => void) => cb(null));
    const measure2 = jest.fn((cb: (b: null) => void) => cb(null));

    function EndDragTrigger() {
      const { endDrag } = useDragContext();
      return (
        <Text accessibilityLabel="end" onPress={() => endDrag(999, 999)}>
          end
        </Text>
      );
    }

    const { getByLabelText } = render(
      <DragProvider>
        <ThemeProvider>
          <DropZoneRegistrar id="zone-a" onMeasureFresh={measure1} />
          <DropZoneRegistrar id="zone-b" onMeasureFresh={measure2} />
          <StartDragTrigger />
          <EndDragTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    fireEvent.press(getByLabelText("start"));
    fireEvent.press(getByLabelText("end"));

    expect(measure1).toHaveBeenCalledTimes(1);
    expect(measure2).toHaveBeenCalledTimes(1);
  });
});
