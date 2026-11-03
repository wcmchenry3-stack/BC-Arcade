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
  formatDragDebugResult,
  getDragDebugResult,
  isDragDebugEnabled,
  noteDragDebugResult,
  resetDragDebugForTests,
  setDragDebugEnabled,
} from "../dragDebug";
import { GHOST_OK, idleGhostCheck } from "../ghostCheckState";

const cards: DragCard[] = [{ suit: "spades", rank: 1, faceDown: false, width: 60, height: 90 }];
const source: DragSource = { game: "solitaire", type: "waste" };

function Starter() {
  const { startDrag } = useDragContext();
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

  it("writes the panel text from a UI reaction, at most every PANEL_INTERVAL_MS", async () => {
    setDragDebugEnabled(true);
    let react: ((cur: number[]) => void) | undefined;
    jest.spyOn(Reanimated, "useAnimatedReaction").mockImplementation(((
      _prepare: unknown,
      cb: (cur: number[]) => void
    ) => {
      react = cb;
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
    react!([10, 20]);
    expect(props!().text).toContain("expected 10,12");
    now.mockReturnValue(1000 + PANEL_INTERVAL_MS - 1);
    react!([11, 21]);
    expect(props!().text).toContain("expected 10,12"); // throttled
    now.mockReturnValue(1000 + PANEL_INTERVAL_MS);
    react!([12, 22]);
    expect(props!().text).toContain("expected 12,14");
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
        "surface 10,105",
        "card:measured container:cached",
      ].join("\n")
    );
  });

  it("surface n/a without a card measure", () => {
    expect(formatPanelText(0, 0, 0, 0, idleGhostCheck())).toContain("surface n/a");
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
