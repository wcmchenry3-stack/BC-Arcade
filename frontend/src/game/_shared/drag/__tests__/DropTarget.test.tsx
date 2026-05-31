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

function StartDragTrigger({ source, cards }: { source: DragSource; cards: DragCard[] }) {
  const { startDrag } = useDragContext();
  return (
    <Text accessibilityLabel="start-drag" onPress={() => startDrag(source, cards)}>
      start
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

  it("does not throw when endDrag fires with a registered zone that has no cached bounds", () => {
    // Simulates the case where onLayout hasn't fired yet — bounds are absent from
    // the cache. endDrag should skip the zone gracefully and snap back.
    function EndDragTrigger() {
      const { endDrag } = useDragContext();
      return (
        <Text accessibilityLabel="end-drag" onPress={() => endDrag(999, 999)}>
          end
        </Text>
      );
    }

    const { getByLabelText } = render(
      wrap(
        <>
          <StartDragTrigger source={dragSource} cards={dragCards} />
          <EndDragTrigger />
          <DropTarget id="pile-fresh" onDrop={() => false} testID="target">
            <Text>Content</Text>
          </DropTarget>
        </>
      )
    );

    fireEvent.press(getByLabelText("start-drag"));
    expect(() => fireEvent.press(getByLabelText("end-drag"))).not.toThrow();
  });

  it("schedules measureInWindow via requestAnimationFrame on layout, not synchronously", () => {
    jest.useFakeTimers();
    const rafSpy = jest.spyOn(global, "requestAnimationFrame");
    const countBefore = rafSpy.mock.calls.length;

    const { getByTestId } = render(
      wrap(
        <DropTarget id="pile-layout" onDrop={() => false} testID="target">
          <Text>Content</Text>
        </DropTarget>
      )
    );

    fireEvent(getByTestId("target"), "layout", {
      nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 50 } },
    });

    // A new rAF should have been scheduled (measureInWindow is NOT called synchronously)
    expect(rafSpy.mock.calls.length).toBeGreaterThan(countBefore);

    rafSpy.mockRestore();
    jest.useRealTimers();
  });

  it("cancels a pending rAF before scheduling a new one on rapid re-layout", () => {
    jest.useFakeTimers();
    const cancelSpy = jest.spyOn(global, "cancelAnimationFrame");

    const { getByTestId } = render(
      wrap(
        <DropTarget id="pile-cancel" onDrop={() => false} testID="target">
          <Text>Content</Text>
        </DropTarget>
      )
    );

    const target = getByTestId("target");
    const layoutEvent = { nativeEvent: { layout: { x: 0, y: 0, width: 100, height: 50 } } };

    // First layout fires a rAF
    fireEvent(target, "layout", layoutEvent);
    // Second layout before first rAF runs — should cancel the first
    fireEvent(target, "layout", layoutEvent);

    expect(cancelSpy).toHaveBeenCalledTimes(1);

    cancelSpy.mockRestore();
    jest.useRealTimers();
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
