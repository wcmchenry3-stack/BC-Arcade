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
import * as keyboardModule from "../useAimKeyboard";
import { useBoardMotion } from "../useBoardMotion";
import { AIM_STATE, aimDropX, aimPieceX } from "../../../game/cascade/aim";
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

// #4081: leaving the board never cancels: the aim goes on, x clamped to the walls.
it("dragging below or above the board keeps aiming and a release drops at the finger's x", async () => {
  const m = await mount();
  await m.press(150);
  await m.move(200);
  await m.move(200, H + 30);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
  await m.move(210, -40);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledTimes(1);
  expect(m.onDrop).toHaveBeenCalledWith(210 / SCALE);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.released);
});

it("releasing past a side wall drops at the clamped x", async () => {
  const m = await mount();
  await m.press(150);
  await m.move(W + 60, -20);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledWith(WORLD_WIDTH - WALL_THICKNESS);
  const n = await mount();
  await n.press(150);
  await n.move(-60, H + 40);
  await n.release();
  expect(n.onDrop).toHaveBeenCalledWith(WALL_THICKNESS);
});

it("a drag past an edge and back keeps aiming and never draws the piece at the ring centre", async () => {
  const m = await mount();
  const v = m.motion.values;
  const r = 15;
  const drawn: number[] = [];
  const sample = () =>
    drawn.push(aimPieceX(v.aimState.value, v.aimX.value, v.aimFromX.value, 0, false, r));
  await m.press(40);
  sample(); // from the first press the piece is at the finger
  for (const x of [20, 0, -50, -80, -50, 0, 20, 40]) {
    await m.move(x, -30);
    expect(v.aimState.value).toBe(AIM_STATE.aiming);
    sample();
  }
  const fingers = [40, 20, 0, -50, -80, -50, 0, 20, 40];
  expect(drawn).toEqual(fingers.map((px) => aimDropX(Math.max(WALL_THICKNESS, px / SCALE), r)));
  await m.release();
  expect(m.onDrop).toHaveBeenCalledWith(40 / SCALE);
});

it("from the first press the aim x follows the finger (no pin at the ring centre)", async () => {
  const m = await mount();
  await m.press(30);
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.pressed);
  expect(m.motion.values.aimX.value).toBeCloseTo(30 / SCALE);
  expect(aimPieceX(AIM_STATE.pressed, m.motion.values.aimX.value, NaN, 0, false, 15)).toBeCloseTo(
    aimDropX(30 / SCALE, 15)
  );
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
it("a press that fails before activating drops nothing and glides back from the press", async () => {
  const m = await mount();
  await act(() => m.pan().onBegin!({ x: 150, y: 200 }));
  await act(() => m.pan().onFinalize!({}, false));
  expect(m.onDrop).not.toHaveBeenCalled();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  expect(m.motion.values.aimFromX.value).toBeCloseTo(150 / SCALE); // glides back from the press
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

// A second finger after the drag started fails the gesture (a cancel): nothing drops.
it("a second finger mid-drag fails the gesture and drops nothing", async () => {
  const m = await mount();
  await m.press(60);
  await m.move(200);
  const second = manager();
  await act(() => m.pan().onTouchesDown!({ numberOfTouches: 2 }, second));
  expect(second.fail).toHaveBeenCalledTimes(1);
  await m.systemCancel();
  expect(m.onDrop).not.toHaveBeenCalled();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  expect(m.motion.values.aimFromX.value).toBeCloseTo(200 / SCALE);
});

// The piece is drawn at the finger from the press, so a cancel from a press glides back from there.
it("a second finger before the drag starts cancels from the press x and drops nothing", async () => {
  const m = await mount();
  await m.press(100);
  const second = manager();
  await act(() => m.pan().onTouchesDown!({ numberOfTouches: 2 }, second));
  await m.systemCancel();
  expect(m.onDrop).not.toHaveBeenCalled();
  expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  expect(m.motion.values.aimFromX.value).toBeCloseTo(100 / SCALE);
  expect(m.motion.values.aimFromX.value).toBe(m.motion.values.aimX.value);
});

it("a non-finite move leaves the aim x alone and the drop still goes at the last good x", async () => {
  const m = await mount();
  await m.press(60);
  await m.move(200);
  await m.move(Number.NaN, Number.NaN);
  expect(m.motion.values.aimX.value).toBeCloseTo(200 / SCALE);
  await m.release();
  expect(m.onDrop).toHaveBeenCalledWith(200 / SCALE);
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

// S3: the area wired to the real keyboard hook, through the ref callback the View receives.
describe("keyboard through the area (#3934)", () => {
  afterEach(() => jest.restoreAllMocks());

  function fakeNode() {
    const l: Record<string, (e: never) => void> = {};
    return {
      l,
      addEventListener: (t: string, f: (e: never) => void) => void (l[t] = f),
      removeEventListener: jest.fn((t: string) => void delete l[t]),
      setAttribute: jest.fn(),
      matches: () => true,
    };
  }
  const k = (key: string) => ({
    key,
    shiftKey: false,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    preventDefault: jest.fn(),
  });

  async function mountWeb() {
    jest.replaceProperty(Platform, "OS", "web");
    const spy = jest.spyOn(keyboardModule, "useAimKeyboard");
    const m = await mount();
    const node = fakeNode();
    const attach = spy.mock.results.at(-1)!.value.attach as (n: unknown) => void;
    await act(async () => attach(node));
    return { m, node, attach };
  }

  it("a refused drop leaves the aim cancelled (the piece glides back)", async () => {
    const { m, node } = await mountWeb();
    accept = false;
    await act(async () => node.l.keydown!(k("ArrowRight") as never));
    await act(async () => node.l.keydown!(k("Enter") as never));
    expect(m.onDrop).toHaveBeenCalled();
    expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
  });

  it("an accepted drop releases the aim at the moved x", async () => {
    const { m, node } = await mountWeb();
    await act(async () => node.l.keydown!(k("ArrowRight") as never));
    await act(async () => node.l.keydown!(k(" ") as never));
    expect(m.onDrop).toHaveBeenCalledWith(WORLD_WIDTH / 2 + MOTION.aim.keyStep);
    expect(m.motion.values.aimState.value).toBe(AIM_STATE.released);
  });

  it("blur cancels the aim", async () => {
    const { m, node } = await mountWeb();
    await act(async () => node.l.keydown!(k("ArrowLeft") as never));
    await act(async () => node.l.blur!(undefined as never));
    expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
    expect(m.onDrop).not.toHaveBeenCalled();
  });

  it("the listener is removed when the ref is released on unmount", async () => {
    const { node, attach } = await mountWeb();
    await act(async () => attach(null)); // React calls the ref with null on unmount
    expect(node.removeEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));
    expect(Object.keys(node.l)).toHaveLength(0);
  });

  it("a key during a mouse drag that left the board is ignored, and the release drops at the clamped x", async () => {
    const { m, node } = await mountWeb();
    await m.press(150);
    await m.move(200);
    await m.move(200, H + 30); // off the board: still aiming (#4081)
    expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
    const e = k("ArrowLeft");
    await act(async () => node.l.keydown!(e as never));
    expect(e.preventDefault).toHaveBeenCalled(); // the page still does not scroll
    expect(m.motion.values.aimX.value).toBeCloseTo(200 / SCALE); // the key did not move it
    await m.release();
    expect(m.onDrop).toHaveBeenCalledWith(200 / SCALE);
  });

  it("once the pointer is up the keys work again, and after Escape too", async () => {
    const { m, node } = await mountWeb();
    await m.press(150);
    await m.release(); // a tap: it drops (accepted) and ends
    expect(m.motion.values.pointerDown.value).toBe(false);
    await act(async () => node.l.keydown!(k("ArrowRight") as never));
    expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
    await act(async () => node.l.keydown!(k("Escape") as never));
    expect(m.motion.values.aimState.value).toBe(AIM_STATE.cancelled);
    await act(async () => node.l.keydown!(k("ArrowLeft") as never));
    expect(m.motion.values.aimState.value).toBe(AIM_STATE.aiming);
  });

  it("names the web tab stop", async () => {
    jest.replaceProperty(Platform, "OS", "web");
    await mount();
    expect(screen.getByTestId("cascade-game-area").props["aria-label"]).toBeTruthy();
  });
});
