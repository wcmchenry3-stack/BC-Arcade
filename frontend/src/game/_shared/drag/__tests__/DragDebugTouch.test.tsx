/**
 * #3878 — the drag debug overlay's touch line. A Maestro swipe on the iOS
 * simulator sometimes leaves no `drag #N` line; this line says which layer
 * the swipe got to: the card's pan (down), its activation (active), its end
 * (end), or the JS thread's handling of the start (js, lag). These tests
 * drive the real DraggableCard pan callbacks as RNGH calls them.
 */
import React from "react";
import { Text } from "react-native";
import { act, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Reanimated from "react-native-reanimated";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { __forceStoreBuildForTests } from "../../buildFlavour";
import { DragProvider } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DraggableCard } from "../DraggableCard";
import { DragGhostHost } from "../DragGhostHost";
import { getDragDebugEnabledFlag, resetDragDebugForTests, setDragDebugEnabled } from "../dragDebug";
import {
  DRAG_DEBUG_TOUCH_TEST_ID,
  dragDebugTouchForCard,
  formatDragDebugTouch,
  getDragDebugTouch,
  resetDragDebugTouchForTests,
} from "../dragDebugTouch";
import { detectedGesture } from "../../../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../../../test-utils/mockScreenDeps";

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

const cards: DragCard[] = [{ suit: "hearts", rank: 7, faceDown: false, width: 52, height: 73 }];
const source: DragSource = { game: "solitaire", type: "waste" };

function Board() {
  return (
    <DragProvider getLegalDropIds={() => []}>
      <ThemeProvider>
        <DraggableCard testID="card" dragCards={cards} dragSource={source}>
          <Text testID="face">7♥</Text>
        </DraggableCard>
        <DragGhostHost />
      </ThemeProvider>
    </DragProvider>
  );
}

const ev = (dx: number, dy: number) => ({
  absoluteX: 100 + dx,
  absoluteY: 200 + dy,
  x: 20 + dx,
  y: 30 + dy,
  translationX: 0,
  translationY: 0,
  velocityX: 0,
  velocityY: 0,
});

function pan() {
  const h = detectedGesture(mockDetected, "pan", { testID: "face" });
  if (!h) throw new Error("no pan gesture");
  return {
    begin: () => act(() => h.onBegin!(ev(0, 0))),
    start: () => act(() => h.onStart!(ev(0, 5))),
    end: (success: boolean) => act(() => h.onEnd!(ev(60, 200), success)),
    finalize: () => act(() => h.onFinalize!(ev(60, 200), true)),
  };
}

const counts = () => {
  const t = getDragDebugTouch();
  return formatDragDebugTouch(t.ui.value, t.js.value);
};

/** The line's text and opacity, as the overlay last rendered them. */
function line(getByTestId: (id: string) => { props: Record<string, unknown>; parent: unknown }) {
  const input = getByTestId(DRAG_DEBUG_TOUCH_TEST_ID);
  const box = (input as unknown as { parent: { props: { style: unknown } } }).parent;
  const style = Object.assign({}, ...[box.props.style].flat(3).filter(Boolean)) as {
    opacity?: number;
  };
  return {
    text: (input.props.animatedProps as { text: string }).text,
    opacity: style.opacity,
  };
}

const ORIGINAL_HOOKS = process.env.EXPO_PUBLIC_TEST_HOOKS;

beforeEach(async () => {
  await AsyncStorage.clear();
  delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  mockDetected.length = 0;
  resetDragDebugForTests();
  resetDragDebugTouchForTests();
});

afterEach(() => {
  __forceStoreBuildForTests(false);
  if (ORIGINAL_HOOKS === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL_HOOKS;
  resetDragDebugForTests();
  resetDragDebugTouchForTests();
  jest.restoreAllMocks();
});

describe("formatDragDebugTouch (#3878)", () => {
  it("formats the counts, with no lag before the first drag", () => {
    expect(formatDragDebugTouch({ down: 0, active: 0, end: 0 }, { js: 0, lagMs: -1 })).toBe(
      "touch down=0 active=0 end=0 js=0 lag=none"
    );
    expect(formatDragDebugTouch({ down: 2, active: 1, end: 1 }, { js: 1, lagMs: 845.4 })).toBe(
      "touch down=2 active=1 end=1 js=1 lag=845ms"
    );
  });
});

describe("drag debug touch line (#3878)", () => {
  it("counts a whole drag: touch-down, activation, the JS start and the end", async () => {
    setDragDebugEnabled(true);
    jest.spyOn(Date, "now").mockReturnValue(1000);
    await render(<Board />);
    const p = pan();
    await p.begin();
    expect(counts()).toBe("touch down=1 active=0 end=0 js=0 lag=none");
    await p.start();
    await p.end(true);
    // onFinalize after an ended pan is not a second end.
    await p.finalize();
    expect(counts()).toBe("touch down=1 active=1 end=1 js=1 lag=0ms");
  });

  it("a touch that never activates counts down only (a tap, or a pan that failed)", async () => {
    setDragDebugEnabled(true);
    await render(<Board />);
    const p = pan();
    await p.begin();
    await p.end(false);
    await p.finalize();
    expect(counts()).toBe("touch down=1 active=0 end=0 js=0 lag=none");
  });

  it("shows a start the JS thread hasn't handled yet, then how late it handled it", async () => {
    setDragDebugEnabled(true);
    // A busy JS thread: hops queue up instead of running at once.
    const hops: (() => void)[] = [];
    jest.spyOn(Reanimated, "runOnJS").mockImplementation(((fn: (...a: unknown[]) => void) =>
      (...args: unknown[]) => {
        hops.push(() => fn(...args));
      }) as never);
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    await render(<Board />);
    const p = pan();
    await p.begin();
    await p.start();
    await p.end(true);
    expect(counts()).toBe("touch down=1 active=1 end=1 js=0 lag=none");

    now.mockReturnValue(1845);
    await act(() => {
      hops.splice(0).forEach((h) => h());
    });
    expect(counts()).toBe("touch down=1 active=1 end=1 js=1 lag=845ms");
  });

  it("is drawn from the first touch on, with the counts as its text", async () => {
    setDragDebugEnabled(true);
    jest.spyOn(Date, "now").mockReturnValue(1000);
    const { getByTestId, rerender } = await render(<Board />);
    // Mounted with the overlay but hidden until a card is touched.
    expect(line(getByTestId)).toEqual({
      text: "touch down=0 active=0 end=0 js=0 lag=none",
      opacity: 0,
    });
    const p = pan();
    await p.begin();
    await p.start();
    await p.end(true);
    // The jest Reanimated mock evaluates animated props at render.
    await rerender(<Board />);
    expect(line(getByTestId)).toEqual({
      text: "touch down=1 active=1 end=1 js=1 lag=0ms",
      opacity: 0.9,
    });
  });

  it("overlay off: no line and nothing counted", async () => {
    const { queryByTestId } = await render(<Board />);
    const p = pan();
    await p.begin();
    await p.start();
    await p.end(true);
    expect(queryByTestId(DRAG_DEBUG_TOUCH_TEST_ID)).toBeNull();
    expect(counts()).toBe("touch down=0 active=0 end=0 js=0 lag=none");
  });

  it("store build: nothing counted even with the setting stored on", async () => {
    setDragDebugEnabled(true);
    __forceStoreBuildForTests(true);
    const { queryByTestId } = await render(<Board />);
    const p = pan();
    await p.begin();
    await p.start();
    await p.end(true);
    expect(queryByTestId(DRAG_DEBUG_TOUCH_TEST_ID)).toBeNull();
    expect(counts()).toBe("touch down=0 active=0 end=0 js=0 lag=none");
  });
});

describe("the setting flipping after the cards mounted (#3878)", () => {
  /** The pan gestures the card has handed RNGH so far, oldest first. */
  const gestures = () => mockDetected.filter((d) => d.childTestID === "face").map((d) => d.gesture);

  it("turned on after mount: the next drag is counted whole", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1000);
    await render(<Board />);
    await act(() => setDragDebugEnabled(true));
    const p = pan();
    await p.begin();
    await p.start();
    await p.end(true);
    await p.finalize();
    expect(counts()).toBe("touch down=1 active=1 end=1 js=1 lag=0ms");
  });

  it("turned off after mount: nothing more is written", async () => {
    setDragDebugEnabled(true);
    jest.spyOn(Date, "now").mockReturnValue(1000);
    await render(<Board />);
    const p = pan();
    await p.begin();
    await p.start();
    await p.end(true);
    expect(counts()).toBe("touch down=1 active=1 end=1 js=1 lag=0ms");

    await act(() => setDragDebugEnabled(false));
    const q = pan();
    await q.begin();
    await q.start();
    await q.end(true);
    await q.finalize();
    expect(counts()).toBe("touch down=1 active=1 end=1 js=1 lag=0ms");
  });

  it("a card re-rendered across a flip keeps its gesture (no fresh worklets)", async () => {
    const { rerender } = await render(<Board />);
    const first = gestures()[0];
    expect(first).toBeDefined();

    await act(() => setDragDebugEnabled(true));
    await rerender(<Board />);
    await act(() => setDragDebugEnabled(false));
    await rerender(<Board />);

    const all = gestures();
    expect(all.length).toBeGreaterThan(1);
    for (const g of all) expect(g).toBe(first);
  });

  it("store build: no flag and no card handle are made", () => {
    __forceStoreBuildForTests(true);
    setDragDebugEnabled(true);
    expect(getDragDebugEnabledFlag()).toBeNull();
    expect(dragDebugTouchForCard()).toBeNull();
  });
});
