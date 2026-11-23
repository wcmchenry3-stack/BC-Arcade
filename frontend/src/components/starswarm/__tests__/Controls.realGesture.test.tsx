/**
 * #4079: Controls' drag through the REAL react-native-gesture-handler (its jest-utils), not the
 * Proxy that `jest.setup.ts` and `Controls.edgeDrag.test.tsx` put in its place. The Proxy calls
 * `onBegin/onChange/onEnd/onFinalize` by hand, so a change in how the library delivers events
 * (order, which callbacks fire, what `translationX` means) would pass there unnoticed. Here the
 * library's own state machine turns BEGAN / ACTIVE / END into the builder's callbacks; a version
 * bump that changes that fails this file.
 */
jest.unmock("react-native-gesture-handler");

import React from "react";
import { render } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import {
  createGestureController,
  fireGestureHandler,
  getByGestureTestId,
} from "react-native-gesture-handler/jest-utils";

import Controls, { STARSWARM_PAN_TEST_ID } from "../Controls";
import type { GameCanvasHandle } from "../GameCanvas";
import { CANVAS_H, CANVAS_W, PLAYER_W } from "../../../game/starswarm/engine";
import type { StarSwarmState } from "../../../game/starswarm/engine";

const MIN_X = PLAYER_W / 2;
const MAX_X = CANVAS_W - PLAYER_W / 2;
const DRAG_Y = CANVAS_H * 0.9; // inside the bottom drag zone at scale 1

/** A canvas whose engine ship follows the commanded X at once, recording every command. */
function makeCanvas() {
  const sent: number[] = [];
  let x = CANVAS_W / 2;
  const handle = {
    setPlayerX: (v: number) => {
      sent.push(v);
      x = v;
    },
    getPlayerX: () => Math.max(MIN_X, Math.min(MAX_X, x)),
    getState: () =>
      ({ phase: "Playing", wave: 1, canvasW: CANVAS_W, player: { x, width: PLAYER_W } }) as
        StarSwarmState | undefined,
  } as unknown as GameCanvasHandle;
  return { handle, sent };
}

async function setup(scale = 1) {
  const canvas = makeCanvas();
  const ref = { current: canvas.handle } as React.RefObject<GameCanvasHandle | null>;
  const ui = (s: number) => (
    <GestureHandlerRootView>
      <Controls
        canvasRef={ref}
        scale={s}
        isLiveRun
        isPaused={false}
        onPause={jest.fn()}
        onResume={jest.fn()}
        onNewGame={jest.fn()}
      />
    </GestureHandlerRootView>
  );
  const r = await render(ui(scale));
  return { ...canvas, rerender: (s: number) => r.rerender(ui(s)) };
}

describe("Controls on the real gesture handler (#4079)", () => {
  it("hard right past the edge, then a reversal moves the ship at once", async () => {
    const { sent } = await setup();
    fireGestureHandler(getByGestureTestId(STARSWARM_PAN_TEST_ID), [
      { y: DRAG_Y, translationX: 0 },
      { y: DRAG_Y, translationX: 100 },
      { y: DRAG_Y, translationX: 400 },
      { y: DRAG_Y, translationX: 399 },
      { y: DRAG_Y, translationX: 300 },
    ]);
    expect(sent.length).toBeGreaterThanOrEqual(4);
    const last4 = sent.slice(-4);
    expect(last4[0]).toBeCloseTo(CANVAS_W / 2 + 100, 5);
    expect(last4[1]).toBe(MAX_X);
    expect(last4[2]).toBeCloseTo(MAX_X - 1, 5);
    expect(last4[3]).toBeCloseTo(MAX_X - 100, 5);
  });

  it("release at the right edge, then a new drag left moves the ship at once", async () => {
    const { sent } = await setup();
    const pan = () => getByGestureTestId(STARSWARM_PAN_TEST_ID);
    fireGestureHandler(pan(), [
      { y: DRAG_Y, translationX: 0 },
      { y: DRAG_Y, translationX: 500 },
    ]);
    expect(sent[sent.length - 1]).toBe(MAX_X);
    fireGestureHandler(pan(), [
      { y: DRAG_Y, translationX: 0 },
      { y: DRAG_Y, translationX: -1 },
      { y: DRAG_Y, translationX: -80 },
    ]);
    expect(sent[sent.length - 2]).toBeCloseTo(MAX_X - 1, 5);
    expect(sent[sent.length - 1]).toBeCloseTo(MAX_X - 80, 5);
  });

  it("re-renders mid-drag (same props, as a score change does) keep the drag alive", async () => {
    const t = await setup(1);
    const pan = createGestureController(STARSWARM_PAN_TEST_ID);
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    for (let i = 1; i <= 10; i++) {
      pan.update({ y: DRAG_Y, translationX: i * 50 });
      await t.rerender(1);
    }
    expect(t.sent[t.sent.length - 1]).toBe(MAX_X);
    pan.update({ y: DRAG_Y, translationX: 470 });
    await t.rerender(1);
    expect(t.sent[t.sent.length - 1]).toBeCloseTo(MAX_X - 30, 5);
    pan.end({ y: DRAG_Y, translationX: 470 });
  });

  it("a re-render mid-drag (new scale) neither stalls nor jumps the ship", async () => {
    const t = await setup(1);
    const pan = createGestureController(STARSWARM_PAN_TEST_ID);
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.update({ y: DRAG_Y, translationX: 400 });
    expect(t.sent[t.sent.length - 1]).toBe(MAX_X);
    await t.rerender(2);
    pan.update({ y: DRAG_Y, translationX: 400 });
    expect(t.sent[t.sent.length - 1]).toBe(MAX_X);
    // 40 screen px back at scale 2 is 20 canvas px.
    pan.update({ y: DRAG_Y, translationX: 360 });
    expect(t.sent[t.sent.length - 1]).toBeCloseTo(MAX_X - 20, 5);
    pan.end({ y: DRAG_Y, translationX: 360 });
  });

  it("a touch above the drag zone never moves the ship", async () => {
    const { sent } = await setup();
    fireGestureHandler(getByGestureTestId(STARSWARM_PAN_TEST_ID), [
      { y: 1, translationX: 0 },
      { y: 1, translationX: 120 },
    ]);
    expect(sent).toEqual([]);
  });
});
