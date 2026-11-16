/**
 * #3928: the board's gesture, fired through the recorded react-native-gesture-handler mock. The
 * callbacks are worklets; under Jest they run directly, so a test sees what the UI thread does.
 */
import React from "react";
import { Text } from "react-native";
import { act, render, renderHook } from "@testing-library/react-native";
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

async function mount(enabled = true) {
  const { result } = await renderHook(() => useBoardMotion(false));
  const onDrop = jest.fn();
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
  const press = (x: number, y = 200) => act(() => pan().onBegin!(at(x, y)));
  const move = (x: number, y = 200) => act(() => pan().onUpdate!(at(x, y)));
  const release = () =>
    act(() => {
      pan().onEnd!({});
      pan().onFinalize!({});
    });
  return { motion: result.current, onDrop, onDragStart, press, move, release };
}

it("a quick tap drops once at its x, with no drag haptic and no guide", async () => {
  const m = await mount();
  await m.press(150);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.pressed);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledTimes(1);
  expect(m.onDrop).toHaveBeenCalledWith(150 / SCALE);
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
