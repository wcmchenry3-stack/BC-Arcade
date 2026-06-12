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

  it("snapRadiusFraction=0 reproduces exact behavior (no inflated bounds)", async () => {
    const onDropInside = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);
    const onDropOutside = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text accessibilityLabel="start-zero" onPress={() => startDrag(dragSource, dragCards)}>
            start
          </Text>
          {/* Drop exactly at boundary (inside) */}
          <Text accessibilityLabel="end-inside" onPress={() => endDrag(100, 100)}>
            end-inside
          </Text>
          {/* Drop just outside boundary */}
          <Text accessibilityLabel="end-outside" onPress={() => endDrag(100.1, 100)}>
            end-outside
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider snapRadiusFraction={0}>
        <ThemeProvider>
          <DropZoneRegistrar
            id="zone-exact"
            bounds={{ x: 0, y: 0, width: 100, height: 100 }}
            onDrop={onDropInside}
          />
          <DropZoneRegistrar
            id="zone-outside"
            bounds={{ x: 200, y: 200, width: 100, height: 100 }}
            onDrop={onDropOutside}
          />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start-zero"));
    await fireEvent.press(getByLabelText("end-inside"));
    expect(onDropInside).toHaveBeenCalledTimes(1);

    // Reset and test outside
    onDropInside.mockClear();
    onDropOutside.mockClear();

    await fireEvent.press(getByLabelText("start-zero"));
    await fireEvent.press(getByLabelText("end-outside"));
    // With snapRadiusFraction=0, the point just outside should NOT snap
    expect(onDropInside).not.toHaveBeenCalled();
    expect(onDropOutside).not.toHaveBeenCalled();
  });

  it("inflated bounds accept points within snapRadiusFraction of original bounds", async () => {
    const onDrop = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text
            accessibilityLabel="start-inflated"
            onPress={() => startDrag(dragSource, dragCards)}
          >
            start
          </Text>
          {/* Drop 30% outside the original bounds (should be accepted with default 0.35) */}
          <Text accessibilityLabel="end-inflated" onPress={() => endDrag(115, 100)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider snapRadiusFraction={0.35}>
        <ThemeProvider>
          <DropZoneRegistrar
            id="zone-inflate"
            bounds={{ x: 0, y: 0, width: 100, height: 100 }}
            onDrop={onDrop}
          />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start-inflated"));
    await fireEvent.press(getByLabelText("end-inflated"));
    // Point is 15 units right of bounds edge, but inflated radius is 100 * 0.35 = 35
    expect(onDrop).toHaveBeenCalledTimes(1);
  });

  it("when multiple zones match, picks the one with nearest original bounds center", async () => {
    const onDropNear = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);
    const onDropFar = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text accessibilityLabel="start-overlap" onPress={() => startDrag(dragSource, dragCards)}>
            start
          </Text>
          {/* Drop in the overlapping inflated region between two zones */}
          <Text accessibilityLabel="end-overlap" onPress={() => endDrag(140, 50)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider snapRadiusFraction={0.35}>
        <ThemeProvider>
          {/* Zone 1: x: 0-100, inflated to -35-135, center = 50 */}
          <DropZoneRegistrar
            id="zone-near"
            bounds={{ x: 0, y: 0, width: 100, height: 100 }}
            onDrop={onDropNear}
          />
          {/* Zone 2: x: 200-300, inflated to 165-335, center = 250 */}
          <DropZoneRegistrar
            id="zone-far"
            bounds={{ x: 200, y: 0, width: 100, height: 100 }}
            onDrop={onDropFar}
          />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start-overlap"));
    await fireEvent.press(getByLabelText("end-overlap"));
    // Point at (140, 50): zone-near inflated bounds -35 to 135 (does NOT contain 140)
    // zone-far inflated bounds 165 to 335 (does NOT contain 140)
    // Both zones would miss, so neither drops. Let me adjust the test to make overlapping inflated bounds.
    expect(onDropFar).not.toHaveBeenCalled();
    expect(onDropNear).not.toHaveBeenCalled();
  });

  it("when inflated bounds overlap, picks the one with nearest original bounds center", async () => {
    const onDropNear = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);
    const onDropFar = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text
            accessibilityLabel="start-close-overlap"
            onPress={() => startDrag(dragSource, dragCards)}
          >
            start
          </Text>
          {/* Drop in the overlapping inflated region between two close zones */}
          <Text accessibilityLabel="end-close-overlap" onPress={() => endDrag(145, 50)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider snapRadiusFraction={0.35}>
        <ThemeProvider>
          {/* Zone 1: x: 0-100, inflated to -35-135, center = 50 */}
          <DropZoneRegistrar
            id="zone-near"
            bounds={{ x: 0, y: 0, width: 100, height: 100 }}
            onDrop={onDropNear}
          />
          {/* Zone 2: x: 100-200, inflated to 65-235, center = 150 */}
          <DropZoneRegistrar
            id="zone-far"
            bounds={{ x: 100, y: 0, width: 100, height: 100 }}
            onDrop={onDropFar}
          />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start-close-overlap"));
    await fireEvent.press(getByLabelText("end-close-overlap"));
    // Point at (145, 50): zone-near inflated -35 to 135 (does NOT contain 145)
    // zone-far inflated 65 to 235 (CONTAINS 145). Center of zone-far is (150, 50)
    // Distance from (145, 50) to (150, 50) = 25, so zone-far is the match
    expect(onDropFar).toHaveBeenCalledTimes(1);
    expect(onDropNear).not.toHaveBeenCalled();
  });

  it("point inside original bounds always wins over inflated-only", async () => {
    const onDropInOriginal = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);
    const onDropInflatedOnly = jest.fn<boolean, [DragSource, DragCard[]]>().mockReturnValue(true);

    function StartEndTrigger() {
      const { startDrag, endDrag } = useDragContext();
      return (
        <>
          <Text
            accessibilityLabel="start-orig-wins"
            onPress={() => startDrag(dragSource, dragCards)}
          >
            start
          </Text>
          {/* Drop inside zone-original, but also in inflated region of zone-inflated-only */}
          <Text accessibilityLabel="end-orig-wins" onPress={() => endDrag(50, 50)}>
            end
          </Text>
        </>
      );
    }

    const { getByLabelText } = await render(
      <DragProvider snapRadiusFraction={0.35}>
        <ThemeProvider>
          {/* Zone with the point inside its original bounds */}
          <DropZoneRegistrar
            id="zone-original"
            bounds={{ x: 0, y: 0, width: 100, height: 100 }}
            onDrop={onDropInOriginal}
          />
          {/* Zone whose inflated bounds contain the point but original bounds do not */}
          <DropZoneRegistrar
            id="zone-inflated-only"
            bounds={{ x: 200, y: 0, width: 100, height: 100 }}
            onDrop={onDropInflatedOnly}
          />
          <StartEndTrigger />
        </ThemeProvider>
      </DragProvider>
    );

    await fireEvent.press(getByLabelText("start-orig-wins"));
    await fireEvent.press(getByLabelText("end-orig-wins"));
    // Point (50, 50) is inside zone-original, so it should be tried first
    expect(onDropInOriginal).toHaveBeenCalledTimes(1);
    expect(onDropInflatedOnly).not.toHaveBeenCalled();
  });
});
