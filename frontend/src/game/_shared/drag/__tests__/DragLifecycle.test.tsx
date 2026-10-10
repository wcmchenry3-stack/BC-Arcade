/**
 * #2772 — every way a drag can end must clear the drag state (ghost card,
 * hidden source card, drop-target highlights). These tests drive the real
 * DraggableCard pan callbacks (onStart / onEnd / onFinalize) the way
 * react-native-gesture-handler calls them, plus AppState changes, unmounts and
 * a cross-thread shared-value model of the race that left the ghost stuck.
 */
import React, { useEffect, useRef } from "react";
import { AppState, Text } from "react-native";
import type { AppStateStatus } from "react-native";
import { act, render } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { DragProvider, SNAP_BACK_FALLBACK_MS, useDragContext } from "../DragContext";
import type { Bounds, DragCard, DragSource, DropHandler } from "../DragContext";
import { DraggableCard } from "../DraggableCard";
import { DragOverlay } from "../DragOverlay";
import { detectedGesture } from "../../../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../../../test-utils/mockScreenDeps";

// ---------------------------------------------------------------------------
// Gesture-handler mock (src/test-utils/mockScreenDeps.ts): every GestureDetector
// render records its gesture and its child's testID, so tests can fire a
// card's pan callbacks like RNGH does.
// ---------------------------------------------------------------------------

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

const cardA: DragCard[] = [{ suit: "clubs", rank: 11, faceDown: false, width: 60, height: 90 }];
const cardB: DragCard[] = [{ suit: "diamonds", rank: 9, faceDown: false, width: 60, height: 90 }];
const srcA: DragSource = { game: "solitaire", type: "tableau", col: 5, fromIndex: 3 };
const srcB: DragSource = { game: "solitaire", type: "waste" };

const ZONE: Bounds = { x: 0, y: 500, width: 60, height: 90 };
const IN_ZONE = { absoluteX: 30, absoluteY: 540, x: 10, y: 10 };
const NOWHERE = { absoluteX: 300, absoluteY: 50, x: 10, y: 10 };

let ctxRef: ReturnType<typeof useDragContext> | null = null;

function Probe() {
  const ctx = useDragContext();
  ctxRef = ctx;
  return (
    <Text testID="probe">
      {ctx.dragState ? "dragging" : "idle"}|{[...ctx.legalTargetIds].join(",")}
    </Text>
  );
}

function Zone({ onDrop }: { onDrop: DropHandler }) {
  const { registerDropZone, unregisterDropZone, updateDropZoneLayout } = useDragContext();
  const onDropRef = useRef(onDrop);
  useEffect(() => {
    registerDropZone("zone", { onDrop: (s, c) => onDropRef.current(s, c) });
    updateDropZoneLayout("zone", ZONE);
    return () => unregisterDropZone("zone");
  }, [registerDropZone, unregisterDropZone, updateDropZoneLayout]);
  return null;
}

function Board({
  showA = true,
  draggableA = true,
  onDrop = () => true,
}: {
  showA?: boolean;
  draggableA?: boolean;
  onDrop?: DropHandler;
}) {
  return (
    <DragProvider getLegalDropIds={() => ["zone"]}>
      <ThemeProvider>
        <Probe />
        <Zone onDrop={onDrop} />
        {showA && (
          <DraggableCard testID="card-a" dragCards={cardA} dragSource={srcA} draggable={draggableA}>
            <Text testID="a">J♣</Text>
          </DraggableCard>
        )}
        <DraggableCard testID="card-b" dragCards={cardB} dragSource={srcB}>
          <Text testID="b">9♦</Text>
        </DraggableCard>
        <DragOverlay />
      </ThemeProvider>
    </DragProvider>
  );
}

function pan(id: string) {
  const h = detectedGesture(mockDetected, "pan", { testID: id });
  if (!h) throw new Error(`no pan gesture for ${id}`);
  return {
    start: (e = IN_ZONE) => act(() => h.onStart!(e)),
    update: (dx: number, dy: number) =>
      act(() => h.onUpdate!({ ...IN_ZONE, translationX: dx, translationY: dy })),
    end: (e: object, success: boolean) => act(() => h.onEnd!(e, success)),
    finalize: (e: object, success: boolean) => act(() => h.onFinalize!(e, success)),
  };
}

function state(getByTestId: (id: string) => { props: { children: unknown } }) {
  const children = getByTestId("probe").props.children as unknown[];
  return String(children[0]);
}

let springCallbacks: ((finished?: boolean) => void)[];
let withSpringSpy: jest.SpyInstance;
let appStateListeners: Set<(s: AppStateStatus) => void>;
let appStateSpy: jest.SpyInstance;
beforeEach(() => {
  // The pan callbacks (captured in one render, fired after the next) rely on
  // stable shared values, which the global Reanimated mock provides.
  jest.useFakeTimers();
  mockDetected.length = 0;
  ctxRef = null;
  springCallbacks = [];
  withSpringSpy = jest.spyOn(Reanimated, "withSpring").mockImplementation(((
    to: unknown,
    _cfg: unknown,
    cb?: (f?: boolean) => void
  ) => {
    if (cb) springCallbacks.push(cb);
    return to as number;
  }) as never);
  appStateListeners = new Set();
  appStateSpy = jest.spyOn(AppState, "addEventListener").mockImplementation(((
    _type: string,
    cb: (s: AppStateStatus) => void
  ) => {
    appStateListeners.add(cb);
    return { remove: () => appStateListeners.delete(cb) };
  }) as unknown as typeof AppState.addEventListener);
});

afterEach(() => {
  withSpringSpy.mockRestore();
  appStateSpy.mockRestore();
  jest.useRealTimers();
});

const finishSprings = () =>
  act(() => {
    const cbs = springCallbacks.splice(0);
    cbs.forEach((cb) => cb(true));
  });

describe("drag lifecycle (#2772)", () => {
  it("a lift over a target drops and clears; onFinalize after it does not snap back", async () => {
    const onDrop = jest.fn(() => true);
    const { getByTestId, queryByTestId } = await render(<Board onDrop={onDrop} />);
    const a = pan("a");
    await a.start();
    expect(state(getByTestId)).toBe("dragging");
    expect(getByTestId("drag-overlay-ghost")).toBeTruthy();
    expect(getByTestId("probe").props.children).toContain("zone");

    await a.end(IN_ZONE, true);
    await a.finalize(IN_ZONE, true);
    expect(onDrop).toHaveBeenCalledTimes(1);
    expect(state(getByTestId)).toBe("idle");
    expect(queryByTestId("drag-overlay-ghost")).toBeNull();
    expect(withSpringSpy).not.toHaveBeenCalled();
  });

  it("a drop outside every target snaps back and clears when the spring finishes", async () => {
    const onDrop = jest.fn(() => true);
    const { getByTestId, queryByTestId } = await render(<Board onDrop={onDrop} />);
    const a = pan("a");
    await a.start();
    await a.update(250, -480);
    await a.end(NOWHERE, true);
    await a.finalize(NOWHERE, true);
    expect(onDrop).not.toHaveBeenCalled();
    // Still animating back.
    expect(state(getByTestId)).toBe("dragging");
    await finishSprings();
    expect(state(getByTestId)).toBe("idle");
    expect(queryByTestId("drag-overlay-ghost")).toBeNull();
  });

  it("a lost spring callback is cleared by the fallback timer", async () => {
    const { getByTestId } = await render(<Board />);
    const a = pan("a");
    await a.start();
    await a.end(NOWHERE, true);
    springCallbacks = []; // the spring never reports back
    expect(state(getByTestId)).toBe("dragging");
    await act(() => jest.advanceTimersByTime(SNAP_BACK_FALLBACK_MS));
    expect(state(getByTestId)).toBe("idle");
  });

  it("a system-cancelled gesture (onEnd success=false) snaps back without dropping", async () => {
    const onDrop = jest.fn(() => true);
    const { getByTestId } = await render(<Board onDrop={onDrop} />);
    const a = pan("a");
    await a.start();
    // The finger is over a legal target when iOS cancels the touch.
    await a.end(IN_ZONE, false);
    await a.finalize(IN_ZONE, false);
    expect(onDrop).not.toHaveBeenCalled();
    expect(withSpringSpy).toHaveBeenCalled();
    await finishSprings();
    expect(state(getByTestId)).toBe("idle");
  });

  it("onFinalize alone (terminated without onEnd) still clears", async () => {
    const { getByTestId } = await render(<Board />);
    const a = pan("a");
    await a.start();
    await a.finalize(NOWHERE, false);
    await finishSprings();
    expect(state(getByTestId)).toBe("idle");
  });

  it("a pan that never activated (tap / failed) does not touch drag state", async () => {
    const { getByTestId } = await render(<Board />);
    await pan("a").finalize(NOWHERE, false);
    expect(withSpringSpy).not.toHaveBeenCalled();
    expect(state(getByTestId)).toBe("idle");
  });

  it.each(["inactive", "background"] as const)(
    "AppState %s mid-drag clears immediately, and the late gesture end is harmless",
    async (next) => {
      const onDrop = jest.fn(() => true);
      const { getByTestId, queryByTestId } = await render(<Board onDrop={onDrop} />);
      const a = pan("a");
      await a.start();
      expect(state(getByTestId)).toBe("dragging");
      await act(() => appStateListeners.forEach((cb) => cb(next)));
      expect(state(getByTestId)).toBe("idle");
      expect(queryByTestId("drag-overlay-ghost")).toBeNull();
      expect(getByTestId("card-a")).toHaveStyle({ opacity: 1 });

      // The cancel RNGH delivers on return must not drop or resurrect anything.
      await act(() => appStateListeners.forEach((cb) => cb("active")));
      await a.end(IN_ZONE, false);
      await a.finalize(IN_ZONE, false);
      await finishSprings();
      expect(onDrop).not.toHaveBeenCalled();
      expect(state(getByTestId)).toBe("idle");
    }
  );

  it("AppState change with no drag in progress does nothing", async () => {
    const { getByTestId } = await render(<Board />);
    await act(() => appStateListeners.forEach((cb) => cb("background")));
    expect(state(getByTestId)).toBe("idle");
  });

  it("the source card unmounting mid-drag clears the drag", async () => {
    const { getByTestId, rerender, queryByTestId } = await render(<Board />);
    await pan("a").start();
    expect(state(getByTestId)).toBe("dragging");
    await rerender(<Board showA={false} />);
    expect(state(getByTestId)).toBe("idle");
    expect(queryByTestId("drag-overlay-ghost")).toBeNull();
  });

  it("another card unmounting mid-drag does not cancel this drag", async () => {
    const { getByTestId, rerender } = await render(<Board />);
    await pan("b").start();
    expect(ctxRef!.dragState?.source).toEqual(srcB);
    await rerender(<Board showA={false} />);
    expect(ctxRef!.dragState?.source).toEqual(srcB);
    expect(getByTestId("drag-overlay-ghost")).toBeTruthy();
  });

  it("a card that dragged earlier and then unmounts does not cancel a later drag", async () => {
    const { rerender } = await render(<Board />);
    const a = pan("a");
    await a.start();
    await a.end(IN_ZONE, true); // dropped, cleared
    await pan("b").start();
    await rerender(<Board showA={false} />);
    expect(ctxRef!.dragState?.source).toEqual(srcB);
  });

  it("another card becoming non-draggable mid-drag does not cancel this drag", async () => {
    const { rerender } = await render(<Board />);
    await pan("b").start();
    await rerender(<Board draggableA={false} />);
    expect(ctxRef!.dragState?.source).toEqual(srcB);
  });

  it("the source card becoming non-draggable mid-drag clears the drag", async () => {
    const { getByTestId, rerender } = await render(<Board />);
    await pan("a").start();
    await rerender(<Board draggableA={false} />);
    expect(state(getByTestId)).toBe("idle");
  });

  it("rapid re-grab: an earlier snap-back finishing does not clear the new drag", async () => {
    const { getByTestId } = await render(<Board />);
    const a = pan("a");
    await a.start();
    await a.end(NOWHERE, true);
    await a.finalize(NOWHERE, true);
    // Grab the 9♦ while the J♣ is still springing home.
    const b = pan("b");
    await b.start();
    expect(ctxRef!.dragState?.source).toEqual(srcB);
    await finishSprings(); // J♣'s spring lands
    await act(() => jest.advanceTimersByTime(SNAP_BACK_FALLBACK_MS)); // and its fallback
    expect(ctxRef!.dragState?.source).toEqual(srcB);
    expect(getByTestId("card-b")).toHaveStyle({ opacity: 0 });
    expect(getByTestId("card-a")).toHaveStyle({ opacity: 1 });

    await b.end(NOWHERE, true);
    await finishSprings();
    expect(state(getByTestId)).toBe("idle");
  });
});

// ---------------------------------------------------------------------------
// Cross-thread model: on device a JS-thread write to a shared value is applied
// on the UI thread later, and a JS read returns a cached copy until then. The
// old generation guard lived in a shared value, so a start and a snap-back
// handled back to back on the JS thread compared mismatched generations and
// never cleared (#2772).
// ---------------------------------------------------------------------------

describe("drag lifecycle across threads (#2772 root cause)", () => {
  let uiQueue: (() => void)[];
  let onUI: boolean;
  let svSpy: jest.SpyInstance;

  const runOnUIThread = (fn: () => void) => {
    const prev = onUI;
    onUI = true;
    try {
      fn();
    } finally {
      onUI = prev;
    }
  };
  const flushUI = () => {
    while (uiQueue.length > 0) runOnUIThread(uiQueue.shift()!);
  };

  beforeEach(() => {
    uiQueue = [];
    onUI = false;
    svSpy = jest.spyOn(Reanimated, "useSharedValue").mockImplementation(((init: unknown) => {
      const ref = useRef<{ value: unknown } | null>(null);
      if (ref.current === null) {
        let ui = init;
        let cached = init;
        let dirty = false;
        ref.current = {
          get value() {
            if (onUI) return ui;
            if (dirty) {
              cached = ui;
              dirty = false;
            }
            return cached;
          },
          set value(v: unknown) {
            if (onUI) {
              ui = v;
              dirty = true;
            } else {
              uiQueue.push(() => {
                ui = v;
                dirty = true;
              });
            }
          },
        };
      }
      return ref.current;
    }) as never);
  });

  afterEach(() => svSpy.mockRestore());

  it("start + snap-back handled back to back on JS still clears when the spring lands", async () => {
    const { getByTestId } = await render(<Board />);
    // JS thread runs startDrag then snapBackAndClear in one go (e.g. a short
    // flick, or a busy JS thread draining both runOnJS calls together).
    await act(() => {
      ctxRef!.startDrag(srcA, cardA);
      ctxRef!.snapBackAndClear();
    });
    expect(state(getByTestId)).toBe("dragging");
    // The UI thread now applies the queued writes and the spring completes.
    await act(() => {
      flushUI();
      runOnUIThread(() => springCallbacks.splice(0).forEach((cb) => cb(true)));
    });
    expect(state(getByTestId)).toBe("idle");
  });

  it("rapid re-grab: A's spring landing before B's start reaches the UI thread keeps B", async () => {
    await render(<Board />);
    await act(() => {
      ctxRef!.startDrag(srcA, cardA);
    });
    await act(() => flushUI());
    // A is dropped nowhere and springs home; B is grabbed on the JS thread…
    await act(() => {
      ctxRef!.snapBackAndClear();
      ctxRef!.startDrag(srcB, cardB);
    });
    // …and A's spring finishes on the UI thread before B's writes land there.
    await act(() => {
      runOnUIThread(() => springCallbacks.splice(0).forEach((cb) => cb(true)));
      flushUI();
    });
    expect(ctxRef!.dragState?.source).toEqual(srcB);
  });
});
