import React, { useRef } from "react";
import { Text } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, useDragContext } from "../DragContext";
import type { Bounds, DragCard, DragSource, DropHandler } from "../DragContext";

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

/**
 * Registers a drop zone with optional pre-cached bounds.
 * Uses refs for onDrop and bounds to keep effect deps stable across re-renders.
 */
function DropZoneRegistrar({
  id,
  bounds,
  onDrop,
}: {
  id: string;
  bounds?: Bounds;
  onDrop?: DropHandler;
}) {
  const { registerDropZone, unregisterDropZone, updateDropZoneLayout } = useDragContext();
  const onDropRef = useRef<DropHandler>(onDrop ?? (() => false));
  const boundsRef = useRef(bounds);
  React.useEffect(() => {
    registerDropZone(id, { onDrop: (s, c) => onDropRef.current(s, c) });
    if (boundsRef.current) updateDropZoneLayout(id, boundsRef.current);
    return () => unregisterDropZone(id);
  }, [id, registerDropZone, unregisterDropZone, updateDropZoneLayout]);
  return null;
}

describe("DragContext", () => {
  it("snapBackAndClear calls withSpring for the animation", async () => {
    const withSpring = jest.spyOn(Reanimated, "withSpring");

    const { getByLabelText } = await render(wrap(<SnapBackTrigger />));
    await fireEvent.press(getByLabelText("start"));
    await fireEvent.press(getByLabelText("snap"));

    expect(withSpring).toHaveBeenCalled();
    withSpring.mockRestore();
  });

  it("snapBackAndClear clears drag state when spring callback fires (finished=false)", async () => {
    // Override withSpring to immediately call the completion callback simulating
    // an interrupted animation (finished=false) — the original `if (finished)` guard
    // would have silently dropped this, leaving the board stuck in drag-active state.
    const withSpring = jest
      .spyOn(Reanimated, "withSpring")
      .mockImplementation(
        (toValue: unknown, _config: unknown, cb?: (finished: boolean) => void) => {
          cb?.(false);
          return toValue as number;
        }
      );

    function Checker() {
      const { startDrag, snapBackAndClear, dragState } = useDragContext();
      return (
        <>
          <Text accessibilityLabel="start-c" onPress={() => startDrag(dragSource, dragCards)}>
            s
          </Text>
          <Text accessibilityLabel="snap-c" onPress={() => snapBackAndClear()}>
            snap
          </Text>
          <Text testID="state-c">{dragState ? "active" : "idle"}</Text>
        </>
      );
    }

    const { getByLabelText, getByTestId } = await render(wrap(<Checker />));
    await fireEvent.press(getByLabelText("start-c"));
    expect(getByTestId("state-c").props.children).toBe("active");

    await fireEvent.press(getByLabelText("snap-c"));
    expect(getByTestId("state-c").props.children).toBe("idle");

    withSpring.mockRestore();
  });

  it("endDrag snaps back immediately when no drop zones are registered", async () => {
    const withSpring = jest.spyOn(Reanimated, "withSpring");

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text accessibilityLabel="start2" onPress={() => startDrag(dragSource, dragCards)}>
            start
          </Text>
          <Text accessibilityLabel="end2" onPress={() => endDrag(0, 0)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(wrap(<StartEndTrigger />));
    await fireEvent.press(getByLabelText("start2"));
    await fireEvent.press(getByLabelText("end2"));

    expect(withSpring).toHaveBeenCalled();
    withSpring.mockRestore();
  });

  it("endDrag calls onDrop synchronously when finger lands inside pre-cached bounds", async () => {
    const onDrop = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text accessibilityLabel="start3" onPress={() => startDrag(dragSource, dragCards)}>
            start
          </Text>
          <Text accessibilityLabel="end3" onPress={() => endDrag(500, 500)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider>
        <ThemeProvider>
          <DropZoneRegistrar
            id="zone-hit"
            bounds={{ x: 0, y: 0, width: 1000, height: 1000 }}
            onDrop={onDrop}
          />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start3"));
    await fireEvent.press(getByLabelText("end3"));

    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(onDrop).toHaveBeenCalledWith(dragSource, dragCards);
  });

  it("endDrag snaps back when finger is outside all cached bounds", async () => {
    const withSpring = jest.spyOn(Reanimated, "withSpring");

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text accessibilityLabel="start4" onPress={() => startDrag(dragSource, dragCards)}>
            start
          </Text>
          {/* Drop at (9999, 9999) — outside the 100x100 zone */}
          <Text accessibilityLabel="end4" onPress={() => endDrag(9999, 9999)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider>
        <ThemeProvider>
          <DropZoneRegistrar id="zone-miss" bounds={{ x: 0, y: 0, width: 100, height: 100 }} />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start4"));
    await fireEvent.press(getByLabelText("end4"));

    expect(withSpring).toHaveBeenCalled();
    withSpring.mockRestore();
  });

  it("endDrag skips zones with no cached bounds rather than crashing", async () => {
    const onDrop = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text accessibilityLabel="start5" onPress={() => startDrag(dragSource, dragCards)}>
            start
          </Text>
          <Text accessibilityLabel="end5" onPress={() => endDrag(50, 50)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider>
        <ThemeProvider>
          {/* No bounds provided — layout hasn't fired yet */}
          <DropZoneRegistrar id="zone-no-bounds" onDrop={onDrop} />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start5"));
    await fireEvent.press(getByLabelText("end5"));
    // onDrop must NOT be called because no bounds were cached
    expect(onDrop).not.toHaveBeenCalled();
  });
});
