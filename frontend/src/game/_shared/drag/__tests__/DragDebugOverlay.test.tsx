import React from "react";
import { Text } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as Reanimated from "react-native-reanimated";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import { __forceStoreBuildForTests } from "../../buildFlavour";
import { DragProvider, useDragContext } from "../DragContext";
import type { DragCard, DragSource } from "../DragContext";
import { DragGhostHost } from "../DragGhostHost";
import { PANEL_INTERVAL_MS, formatPanelText } from "../DragDebugOverlay";
import {
  formatDragDebugDrop,
  formatDragDebugResult,
  formatDragDebugSeq,
  getDragDebugDrop,
  getDragDebugResult,
  getDragDebugResultSeq,
  isDragDebugEnabled,
  noteDragDebugResult,
  resetDragDebugForTests,
  setDragDebugEnabled,
} from "../dragDebug";
import { GHOST_FAIL, GHOST_OK, idleGhostCheck } from "../ghostCheckState";
import { formatUnmeasuredDetail } from "../dragDiagnostics";

const cards: DragCard[] = [{ suit: "spades", rank: 1, faceDown: false, width: 60, height: 90 }];
const source: DragSource = { game: "solitaire", type: "waste" };

let ctx: ReturnType<typeof useDragContext> | null = null;
function Starter() {
  const c = useDragContext();
  ctx = c;
  const { startDrag } = c;
  return (
    <Text accessibilityLabel="start" onPress={() => startDrag(source, cards)}>
      start
    </Text>
  );
}

function App() {
  return (
    <DragProvider>
      <ThemeProvider>
        <Starter />
        <DragGhostHost />
      </ThemeProvider>
    </DragProvider>
  );
}

const ORIGINAL_HOOKS = process.env.EXPO_PUBLIC_TEST_HOOKS;

beforeEach(async () => {
  await AsyncStorage.clear();
  delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  resetDragDebugForTests();
});

afterEach(() => {
  __forceStoreBuildForTests(false);
  if (ORIGINAL_HOOKS === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL_HOOKS;
  resetDragDebugForTests();
  jest.restoreAllMocks();
});

describe("DragDebugOverlay (#3529)", () => {
  it("renders nothing when disabled", async () => {
    const { getByLabelText, queryByTestId } = await render(<App />);
    await fireEvent.press(getByLabelText("start"));
    expect(queryByTestId("drag-debug-panel")).toBeNull();
    expect(queryByTestId("drag-debug-crosshair")).toBeNull();
    expect(queryByTestId("drag-debug-expected")).toBeNull();
    expect(queryByTestId("drag-debug-result")).toBeNull();
  });

  it("shows the crosshair, expected outline and panel while a drag is active", async () => {
    setDragDebugEnabled(true);
    const { getByLabelText, getByTestId, queryByTestId } = await render(<App />);
    expect(queryByTestId("drag-debug-crosshair")).toBeNull();
    await fireEvent.press(getByLabelText("start"));
    expect(getByTestId("drag-debug-crosshair")).toBeTruthy();
    expect(getByTestId("drag-debug-panel")).toBeTruthy();
    const style = Object.assign(
      {},
      ...[getByTestId("drag-debug-expected").props.style].flat(2).filter(Boolean)
    );
    expect(style).toMatchObject({ width: 60, height: 90 });
  });

  it("shows a stored result line with an accessible label", async () => {
    setDragDebugEnabled(true);
    const { getByTestId } = await render(<App />);
    await act(() => noteDragDebugResult({ status: "ok", dx: 1, dy: -2 }));
    const line = getByTestId("drag-debug-result");
    expect(line.props.children).toBe("drag-check: ok Δ(1,-2)");
    expect(line.props.accessibilityLabel).toBe("drag-check: ok Δ(1,-2)");
  });

  it("writes the panel from a UI frame callback at most every PANEL_INTERVAL_MS, with a trailing edge", async () => {
    setDragDebugEnabled(true);
    let frame: (() => void) | undefined;
    jest.spyOn(Reanimated, "useFrameCallback").mockImplementation(((cb: () => void) => {
      frame = cb;
    }) as never);
    let props: (() => { text: string }) | undefined;
    jest.spyOn(Reanimated, "useAnimatedProps").mockImplementation(((fn: () => { text: string }) => {
      props = fn;
      return fn();
    }) as never);
    const now = jest.spyOn(Date, "now");
    const { getByLabelText } = await render(<App />);
    await fireEvent.press(getByLabelText("start"));

    now.mockReturnValue(1000);
    ctx!.cardX.value = 10;
    ctx!.cardY.value = 20;
    frame!();
    expect(props!().text).toContain("expected 10,12");
    now.mockReturnValue(1000 + PANEL_INTERVAL_MS - 1);
    ctx!.cardX.value = 11;
    frame!();
    expect(props!().text).toContain("expected 10,12"); // throttled
    // The finger has stopped: the next window still writes the latest values.
    now.mockReturnValue(1000 + PANEL_INTERVAL_MS);
    frame!();
    expect(props!().text).toContain("expected 11,12");

    // A check-state change with no finger movement is written too.
    expect(props!().text).toContain("check idle");
    expect(props!().text).toContain("ghost measured n/a");
    ctx!.ghostCheck.value = {
      ...idleGhostCheck(),
      state: GHOST_OK,
      ghostMeasured: true,
      ghostPageX: 1,
      ghostPageY: 5,
    };
    now.mockReturnValue(1000 + 2 * PANEL_INTERVAL_MS);
    frame!();
    expect(props!().text).toContain("check ok");
    expect(props!().text).not.toContain("ghost measured n/a");
  });

  it("a result noted in the same batch as the next drag's start survives", async () => {
    setDragDebugEnabled(true);
    const { getByLabelText, getByTestId } = await render(<App />);
    await act(() => noteDragDebugResult({ status: "ok", dx: 1, dy: 1 }));
    await act(async () => {
      ctx!.startDrag(source, cards);
      noteDragDebugResult({ status: "fail", failKind: "render", dx: 0, dy: 9 });
    });
    expect(getByTestId("drag-debug-result").props.children).toBe("drag-check: FAIL render Δ(0,9)");
    expect(getByLabelText("start")).toBeTruthy();
  });

  it("the previous drag's result is gone after the next startDrag", async () => {
    setDragDebugEnabled(true);
    const { queryByTestId } = await render(<App />);
    await act(() => noteDragDebugResult({ status: "ok", dx: 1, dy: 1 }));
    expect(queryByTestId("drag-debug-result")).not.toBeNull();
    await act(async () => {
      ctx!.startDrag(source, cards);
    });
    expect(getDragDebugResult()).toBeNull();
    expect(queryByTestId("drag-debug-result")).toBeNull();
  });

  // #3532: Maestro asserts `drag #N` after its N-th swipe, so a swipe that
  // never started a drag can't pass on the previous drag's `ok`.
  it("numbers each result in a visible drag-debug-seq line", async () => {
    setDragDebugEnabled(true);
    const { getByTestId, queryByTestId } = await render(<App />);
    expect(queryByTestId("drag-debug-seq")).toBeNull();
    await act(() => noteDragDebugResult({ status: "ok", dx: 0, dy: 0 }));
    expect(getByTestId("drag-debug-seq").props.children).toBe("drag #1");
    // The next drag's start hides the line but keeps the count.
    await act(async () => {
      ctx!.startDrag(source, cards);
    });
    expect(queryByTestId("drag-debug-seq")).toBeNull();
    await act(() => noteDragDebugResult({ status: "fail", failKind: "render", dx: 0, dy: 9 }));
    expect(getByTestId("drag-debug-seq").props.children).toBe("drag #2");
    expect(getByTestId("drag-debug-result").props.children).toBe("drag-check: FAIL render Δ(0,9)");
  });

  it("counts nothing while the overlay is off", async () => {
    noteDragDebugResult({ status: "ok", dx: 0, dy: 0 });
    expect(getDragDebugResultSeq()).toBe(0);
    setDragDebugEnabled(true);
    noteDragDebugResult({ status: "ok", dx: 0, dy: 0 });
    expect(getDragDebugResultSeq()).toBe(1);
    expect(formatDragDebugSeq(getDragDebugResultSeq())).toBe("drag #1");
  });

  it("turning the setting off forgets the result", async () => {
    setDragDebugEnabled(true);
    noteDragDebugResult({ status: "ok", dx: 1, dy: 1 });
    setDragDebugEnabled(false);
    setDragDebugEnabled(true);
    expect(getDragDebugResult()).toBeNull();
  });
});

describe("formatPanelText", () => {
  it("lists finger, expected ghost, grab, check deltas, surface and sources", () => {
    const gc = {
      ...idleGhostCheck(),
      state: GHOST_OK,
      deltaX: 1,
      deltaY: -2,
      deltaMeasureX: 3,
      deltaMeasureY: 4,
      cardMeasured: true,
      cardMeasuredX: 100,
      cardMeasuredY: 150,
      fingerStartX: 130,
      fingerStartY: 290,
      grabX: 20,
      grabY: 35,
      cardSource: "measured" as const,
      containerSource: "cached" as const,
    };
    expect(formatPanelText(100, 200, 20, 35, gc)).toBe(
      [
        "finger 120,235",
        "expected 100,192",
        "grab 20,35",
        "check ok d(1,-2) dm(3,4)",
        "ghost measured n/a",
        "surface 10,105",
        "container used 0,0",
        "card measured 100,150",
        "card:measured container:cached",
      ].join("\n")
    );
  });

  it("lists container used, card measured and the ghost frame found by the check", () => {
    const gc = {
      ...idleGhostCheck(),
      state: GHOST_OK,
      ghostMeasured: true,
      ghostPageX: 181,
      ghostPageY: 375,
      containerUsedX: 5,
      containerUsedY: 90,
      cardMeasured: true,
      cardMeasuredX: 76,
      cardMeasuredY: 150,
      lastFingerX: 200,
      lastFingerY: 300,
      grabX: 20,
      grabY: 35,
      deltaX: 1,
      deltaY: 118,
    };
    const text = formatPanelText(0, 0, 0, 0, gc);
    expect(text).toContain("container used 5,90");
    expect(text).toContain("card measured 76,150");
    expect(text).toContain("ghost measured 181,375");
  });

  it("a ghost never measured (given up after null measures) shows n/a", () => {
    const gc = { ...idleGhostCheck(), state: GHOST_FAIL, measures: 2, deltaX: 0, deltaY: 0 };
    expect(formatPanelText(0, 0, 0, 0, gc)).toContain("ghost measured n/a");
  });

  it("a ghost stuck at the host origin shows the measured origin, not the expected one", () => {
    const gc = {
      ...idleGhostCheck(),
      state: GHOST_FAIL,
      measures: 1,
      ghostMeasured: true,
      ghostPageX: 0,
      ghostPageY: 0,
      lastFingerX: 200,
      lastFingerY: 300,
    };
    expect(formatPanelText(180, 270, 20, 30, gc)).toContain("ghost measured 0,0");
  });

  it("surface n/a without a card measure", () => {
    expect(formatPanelText(0, 0, 0, 0, idleGhostCheck())).toContain("surface n/a");
  });
});

// #3532: the drop outcome line, set from the JS end-of-drag path.
describe("drag-debug-drop", () => {
  function DropApp() {
    return (
      <DragProvider getLegalDropIds={() => ["zone-a", "zone-b"]}>
        <ThemeProvider>
          <Starter />
          <DragGhostHost />
        </ThemeProvider>
      </DragProvider>
    );
  }

  async function mountWithZones() {
    setDragDebugEnabled(true);
    const api = await render(<DropApp />);
    const onDropA = jest.fn(() => true);
    const onDropB = jest.fn(() => false);
    await act(async () => {
      ctx!.registerDropZone("zone-a", { onDrop: onDropA });
      ctx!.registerDropZone("zone-b", { onDrop: onDropB });
      ctx!.updateDropZoneLayout("zone-a", { x: 10, y: 200, width: 60, height: 90 });
      ctx!.updateDropZoneLayout("zone-b", { x: 300, y: 200, width: 60, height: 90 });
      ctx!.startDrag(source, cards);
    });
    return { api, onDropA, onDropB };
  }

  it("shows the accepting zone", async () => {
    const { api, onDropA } = await mountWithZones();
    await act(async () => ctx!.endDrag(40, 240));
    expect(onDropA).toHaveBeenCalled();
    expect(api.getByTestId("drag-debug-drop").props.children).toBe("drop: accepted zone-a");
  });

  it("shows a snap-back with the zone that refused, the zone count and the nearest legal zone's bounds", async () => {
    const { api } = await mountWithZones();
    await act(async () => ctx!.endDrag(330, 240));
    expect(api.getByTestId("drag-debug-drop").props.children).toBe(
      "drop: snapBack hit=zone-b zones=2 missing=0 finger=330,240 near=zone-b@300,200,60x90"
    );
  });

  it("shows a miss with hit=none and the nearest legal zone", async () => {
    const { api } = await mountWithZones();
    await act(async () => ctx!.endDrag(150, 600));
    expect(api.getByTestId("drag-debug-drop").props.children).toBe(
      "drop: snapBack hit=none zones=2 missing=0 finger=150,600 near=zone-a@10,200,60x90"
    );
  });

  it("shows a cancel's reason, and the next drag's start clears the line", async () => {
    const { api } = await mountWithZones();
    await act(async () => ctx!.cancelDrag("appState:background"));
    expect(api.getByTestId("drag-debug-drop").props.children).toBe(
      "drop: cancelled appState:background"
    );
    await act(async () => {
      ctx!.startDrag(source, cards);
    });
    expect(api.queryByTestId("drag-debug-drop")).toBeNull();
  });

  it("records nothing while the overlay is off", async () => {
    await mountWithZones();
    setDragDebugEnabled(false);
    await act(async () => ctx!.endDrag(40, 240));
    expect(getDragDebugDrop()).toBeNull();
  });

  it("formats each outcome", () => {
    expect(formatDragDebugDrop({ kind: "accepted", zone: "z", snapped: true })).toBe(
      "drop: accepted z (snap)"
    );
    expect(formatDragDebugDrop({ kind: "cancelled", reason: "gesture" })).toBe(
      "drop: cancelled gesture"
    );
    expect(
      formatDragDebugDrop({
        kind: "snapBack",
        hit: null,
        zones: 0,
        missing: 3,
        fingerX: 1.4,
        fingerY: NaN,
        near: null,
      })
    ).toBe("drop: snapBack hit=none zones=0 missing=3 finger=1,? near=none");
  });
});

// #3532 diagnostics: an unmeasured result says why.
describe("unmeasured detail", () => {
  it("formats the reason, attempts, measures, mount and end times", () => {
    const base = { status: "unmeasured" as const, deltaX: 0, deltaY: 0 };
    const summary = { ...base, deltaMeasureX: 0, deltaMeasureY: 0 };
    expect(
      formatUnmeasuredDetail({
        ...summary,
        why: "notMounted",
        attempts: 3,
        measures: 0,
        mountMs: -1,
        endMs: 612.4,
      })
    ).toBe("notMounted a=3 m=0 mount=none end=+612ms");
    expect(
      formatUnmeasuredDetail({
        ...summary,
        why: "nullMeasure",
        attempts: 4,
        measures: 3,
        mountMs: 118,
        endMs: 600,
      })
    ).toBe("nullMeasure a=4 m=3 mount=+118ms end=+600ms");
    expect(formatUnmeasuredDetail(summary)).toBe("");
  });

  it("the overlay line appends it and still reads unmeasured", () => {
    const line = formatDragDebugResult({
      status: "unmeasured",
      dx: 0,
      dy: 0,
      detail: "noRef a=1 m=0 mount=none end=+90ms",
    });
    expect(line).toBe("drag-check: unmeasured noRef a=1 m=0 mount=none end=+90ms");
    expect(line).toMatch(/^drag-check: unmeasured.*/);
  });
});

describe("formatDragDebugResult", () => {
  it("formats ok, FAIL and unmeasured", () => {
    expect(formatDragDebugResult({ status: "ok", dx: 1.4, dy: -1.6 })).toBe(
      "drag-check: ok Δ(1,-2)"
    );
    expect(formatDragDebugResult({ status: "fail", failKind: "render", dx: 0, dy: 118 })).toBe(
      "drag-check: FAIL render Δ(0,118)"
    );
    expect(formatDragDebugResult({ status: "ok", dx: NaN, dy: Infinity })).toBe(
      "drag-check: ok Δ(?,?)"
    );
    expect(formatDragDebugResult({ status: "unmeasured", dx: 0, dy: 0 })).toBe(
      "drag-check: unmeasured"
    );
  });
});

describe("the setting", () => {
  it("is off by default and on by default when test hooks are enabled", () => {
    expect(isDragDebugEnabled()).toBe(false);
    process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
    resetDragDebugForTests();
    expect(isDragDebugEnabled()).toBe(true);
  });

  it("a store build never shows it, even if a stale value says on", async () => {
    setDragDebugEnabled(true);
    expect(isDragDebugEnabled()).toBe(true);
    __forceStoreBuildForTests(true);
    expect(isDragDebugEnabled()).toBe(false);
    const { getByLabelText, queryByTestId } = await render(<App />);
    await fireEvent.press(getByLabelText("start"));
    noteDragDebugResult({ status: "ok", dx: 0, dy: 0 });
    expect(getDragDebugResult()).toBeNull();
    expect(queryByTestId("drag-debug-panel")).toBeNull();
    expect(queryByTestId("drag-debug-result")).toBeNull();
  });
});
