/**
 * #3928: the board's gesture, fired through the recorded react-native-gesture-handler mock in
 * the order RNGH calls an activated gesture (review S2): onBegin, onTouchesDown (the gesture
 * activates itself there: manual activation, review B1), onUpdate…, onEnd(e, success),
 * onFinalize(e, success). `success` false is a system cancel (review B2). The callbacks are
 * worklets; under Jest they run directly, so a test sees what the UI thread does.
 */
import React from "react";
import { Platform, Text } from "react-native";
import { act, render, renderHook, screen } from "@testing-library/react-native";
import CascadeAimArea from "../CascadeAimArea";
import { useBoardMotion } from "../useBoardMotion";
import { AIM_STATE } from "../../../game/cascade/aim";
import { MOTION } from "../../../game/cascade/motion";
import { WALL_THICKNESS, WORLD_WIDTH } from "../../../game/cascade/constants";
import { detectedGesture, type DetectorRender } from "../../../test-utils/mockScreenDeps";

const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);

const SCALE = 0.75; // a 300 x 450 board view
const W = 300;
const H = 450;

beforeEach(() => {
  jest.useFakeTimers();
  mockDetected.length = 0;
});
afterEach(() => jest.useRealTimers());

let accept = true;
beforeEach(() => {
  accept = true;
});

/** The state manager RNGH hands the touch callbacks. */
function manager() {
  return { activate: jest.fn(), fail: jest.fn(), begin: jest.fn(), end: jest.fn() };
}

async function mount(enabled = true) {
  const { result } = await renderHook(() => useBoardMotion(false));
  const onDrop = jest.fn((_x: number) => accept);
  const onDragStart = jest.fn();
  await render(
    <CascadeAimArea
      style={{ position: "absolute", width: W, height: H }}
      motion={result.current}
      scale={SCALE}
      enabled={enabled}
      onDrop={onDrop}
      onDragStart={onDragStart}
    >
      <Text>board</Text>
    </CascadeAimArea>
  );
  const pan = () => detectedGesture(mockDetected, "pan", { testID: "cascade-game-area" })!;
  const at = (x: number, y = 200) => ({ x, y });
  let m = manager();
  const press = (x: number, y = 200) =>
    act(() => {
      m = manager();
      pan().onBegin!(at(x, y));
      pan().onTouchesDown!({ numberOfTouches: 1 }, m);
    });
  const move = (x: number, y = 200) => act(() => pan().onUpdate!(at(x, y)));
  /** The finger lifts: the gesture ends successfully. */
  const release = () =>
    act(() => {
      pan().onEnd!({}, true);
      pan().onFinalize!({}, true);
    });
  /** The system takes the gesture over (swipe-back, a modal, the background). */
  const systemCancel = () =>
    act(() => {
      pan().onEnd!({}, false);
      pan().onFinalize!({}, false);
    });
  return {
    motion: result.current,
    onDrop,
    onDragStart,
    press,
    move,
    release,
    systemCancel,
    pan,
    manager: () => m,
  };
}

it("a quick tap drops once at its x, with no drag haptic and no guide", async () => {
  const m = await mount();
  await m.press(150);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.pressed);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledTimes(1);
  expect(m.onDrop).toHaveBeenCalledWith(150 / SCALE);
  expect(m.manager().activate).toHaveBeenCalledTimes(1); // activated on touch down (B1)
  expect(m.onDragStart).not.toHaveBeenCalled();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.idle);
});

it("a drag aims, ticks the haptic once, and drops at the moved x", async () => {
  const m = await mount();
  await m.press(60);
  for (const x of [70, 120, 180, 240]) await m.move(x);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
  expect(m.onDragStart).toHaveBeenCalledTimes(1);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledWith(240 / SCALE);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.released);
});

it("a small wobble stays a tap", async () => {
  const m = await mount();
  await m.press(150);
  await m.move(150 + MOTION.aim.tapSlopPt - 1);
  await m.release();
  expect(m.onDragStart).not.toHaveBeenCalled();
  expect(m.onDrop).toHaveBeenCalledTimes(1);
});

it("dragging off the board cancels: the piece glides back and a release drops nothing", async () => {
  const m = await mount();
  await m.press(150);
  await m.move(200);
  await m.move(200, H + 30);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  expect(m.motion.values.aimFromX.value).toBeCloseTo(200 / SCALE);
  await m.release();
  expect(m.onDrop).not.toHaveBeenCalled();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
});

it("coming back onto the board before release re-arms", async () => {
  const m = await mount();
  await m.press(150);
  await m.move(W + 40);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  await m.move(90);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledWith(90 / SCALE);
});

it("clamps to the walls", async () => {
  const m = await mount();
  await m.press(1);
  await m.release();
  await m.press(W - 1);
  await m.release();
  expect(m.onDrop.mock.calls.map(([x]) => x)).toEqual([
    WALL_THICKNESS,
    WORLD_WIDTH - WALL_THICKNESS,
  ]);
});

it("never drops at a non-finite x (#3922)", async () => {
  const m = await mount();
  await m.press(Number.NaN);
  await m.move(Number.NaN);
  await m.release();
  expect(m.onDrop).not.toHaveBeenCalled();
});

it("a held press becomes aiming after the tap window, through the motion clock", async () => {
  const m = await mount();
  await m.press(150);
  await act(async () => {
    jest.advanceTimersByTime(MOTION.aim.guideDelayMs + 40);
  });
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
  expect(m.onDragStart).not.toHaveBeenCalled(); // holding still is not a drag
  await m.release();
  expect(m.onDrop).toHaveBeenCalledTimes(1);
});

// Review B1: a native Pan used to activate only after a move, so a still tap ended BEGAN →
// FAILED (onFinalize(false) with no onEnd) and never dropped. With manual activation that order
// cannot come from a single still finger any more; if it ever does (the system failed the gesture
// before it activated), it is a cancel: nothing drops and the piece stays in the ring.
it("a press that fails before activating drops nothing and stays in the ring", async () => {
  const m = await mount();
  await act(() => m.pan().onBegin!({ x: 150, y: 200 }));
  await act(() => m.pan().onFinalize!({}, false));
  expect(m.onDrop).not.toHaveBeenCalled();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  expect(Number.isNaN(m.motion.values.aimFromX.value)).toBe(true);
});

// Review B2: iOS swipe-back, Android edge-back, a modal, the background, `enabled` flipping.
it("a system cancel mid-drag drops nothing and the piece glides back", async () => {
  const m = await mount();
  await m.press(60);
  await m.move(200);
  await m.systemCancel();
  expect(m.onDrop).not.toHaveBeenCalled();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  expect(m.motion.values.aimFromX.value).toBeCloseTo(200 / SCALE);
});

it("a system cancel of a still press drops nothing", async () => {
  const m = await mount();
  await m.press(150);
  await m.systemCancel();
  expect(m.onDrop).not.toHaveBeenCalled();
});

it("a second finger fails the gesture: no drop at the centroid", async () => {
  const m = await mount();
  await m.press(100);
  const second = manager();
  await act(() => m.pan().onTouchesDown!({ numberOfTouches: 2 }, second));
  expect(second.fail).toHaveBeenCalledTimes(1);
  expect(second.activate).not.toHaveBeenCalled();
  await m.systemCancel(); // a failed gesture ends unsuccessfully
  expect(m.onDrop).not.toHaveBeenCalled();
});

// Review S1: re-arming after the glide back has stopped the clock starts it again.
it("re-arming after the glide back wakes the motion clock again", async () => {
  const m = await mount();
  await m.press(150);
  await m.move(200);
  await m.move(200, H + 30);
  await act(async () => {
    jest.advanceTimersByTime(MOTION.aim.returnMs + MOTION.aim.outMs + 100);
  });
  const stopped = m.motion.values.clock.value;
  await act(async () => {
    jest.advanceTimersByTime(200);
  });
  expect(m.motion.values.clock.value).toBe(stopped); // idle while the finger is held off-board
  await m.move(120);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
  await act(async () => {
    jest.advanceTimersByTime(100);
  });
  expect(m.motion.values.clock.value).toBeGreaterThan(stopped);
});

// Review N4: a refused aimed release (the cooldown, the lid) glides back like a cancel.
it("a refused aimed release glides the piece back to the ring", async () => {
  const m = await mount();
  accept = false;
  await m.press(60);
  await m.move(240);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledWith(240 / SCALE);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  expect(m.motion.values.aimFromX.value).toBeCloseTo(240 / SCALE);
  await act(async () => {
    jest.advanceTimersByTime(50);
  });
  expect(Number.isFinite(m.motion.values.aimAt.value)).toBe(true); // stamped by the UI clock
});

it("a refused tap just ends (the piece never left the ring)", async () => {
  const m = await mount();
  accept = false;
  await m.press(150);
  await m.release();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.idle);
});

// #3934: keyboard aiming is web only; the board is a tab stop there and nowhere else.
describe("keyboard focus (#3934)", () => {
  afterEach(() => jest.restoreAllMocks());
  const board = () => screen.getByTestId("cascade-game-area");

  it("is a tab stop on web", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await mount();
    expect(board().props.tabIndex).toBe(0);
  });

  it("is not focusable on iOS or Android", async () => {
    jest.replaceProperty(Platform, "OS", "ios");
    await mount();
    expect(board().props.tabIndex).toBeUndefined();
  });
});
