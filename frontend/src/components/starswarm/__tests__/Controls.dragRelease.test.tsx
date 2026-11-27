/**
 * #4079 (edge-drag CI flake): the finger's position at lift-off.
 *
 * A pan's END carries the translation of the touch-up, and neither react-native-gesture-handler
 * (Android `PanGestureHandler`, iOS `UIPanGestureRecognizer`) sends a move/`onChange` for it. A
 * lift that lands beyond the last move — a fast flick, or an injected swipe whose time-based
 * interpolation fell behind under load (Android's `input swipe` stops sending moves at the
 * deadline and then sends the up at the end point) — used to leave the ship where the last
 * `onChange` put it: part of the way, then stuck. Controls now applies the release translation
 * in `onEnd` under the same rules as a move (clamp, autopilot, re-anchor), and never when the
 * gesture was cancelled.
 *
 * Driven through the REAL gesture handler, as `Controls.realGesture.test.tsx` is.
 */
jest.unmock("react-native-gesture-handler");

import React from "react";
import { render } from "@testing-library/react-native";
import { GestureHandlerRootView } from "react-native-gesture-handler";
import { createGestureController } from "react-native-gesture-handler/jest-utils";

import Controls, { STARSWARM_PAN_TEST_ID } from "../Controls";
import type { GameCanvasHandle } from "../GameCanvas";
import { CANVAS_H, CANVAS_W, PLAYER_W } from "../../../game/starswarm/engine";
import type { StarSwarmState } from "../../../game/starswarm/engine";

const MIN_X = PLAYER_W / 2;
const MAX_X = CANVAS_W - PLAYER_W / 2;
const DRAG_Y = CANVAS_H * 0.9; // inside the bottom drag zone at scale 1

/** A canvas whose engine ship follows the commanded X at once; `game` is mutable per test. */
function makeCanvas() {
  const sent: number[] = [];
  const game = { phase: "Playing", wave: 1, x: CANVAS_W / 2 };
  const handle = {
    setPlayerX: (v: number) => {
      sent.push(v);
      game.x = v;
    },
    getPlayerX: () => Math.max(MIN_X, Math.min(MAX_X, game.x)),
    getState: () =>
      ({
        phase: game.phase,
        wave: game.wave,
        canvasW: CANVAS_W,
        player: { x: game.x, width: PLAYER_W },
      }) as unknown as StarSwarmState,
  } as unknown as GameCanvasHandle;
  return { handle, sent, game };
}

async function setup(scale = 1) {
  const canvas = makeCanvas();
  const ref = { current: canvas.handle } as React.RefObject<GameCanvasHandle | null>;
  await render(
    <GestureHandlerRootView>
      <Controls
        canvasRef={ref}
        scale={scale}
        isLiveRun
        isPaused={false}
        onPause={jest.fn()}
        onResume={jest.fn()}
        onNewGame={jest.fn()}
      />
    </GestureHandlerRootView>
  );
  return { ...canvas, pan: createGestureController(STARSWARM_PAN_TEST_ID) };
}

describe("Controls applies the release position (#4079 edge-drag flake)", () => {
  it("a lift beyond the last move carries the ship to the lift position", async () => {
    const { sent, pan } = await setup();
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.update({ y: DRAG_Y, translationX: 60 });
    expect(sent[sent.length - 1]).toBeCloseTo(CANVAS_W / 2 + 60, 5);
    pan.end({ y: DRAG_Y, translationX: 110 });
    expect(sent[sent.length - 1]).toBeCloseTo(CANVAS_W / 2 + 110, 5);
  });

  it("the edge-drag flow's swipe: moves stop at 2/3 of the way, the lift pins the ship at the edge", async () => {
    // Scale 1.14 (a 411 dp-wide phone), 50% -> 99% of the width: ~201 dp, ~176 canvas units.
    const scale = 1.14;
    const { sent, pan } = await setup(scale);
    pan.begin({ y: DRAG_Y * scale, translationX: 0 });
    pan.activate({ y: DRAG_Y * scale, translationX: 0 });
    for (const tx of [20, 60, 100, 132]) pan.update({ y: DRAG_Y * scale, translationX: tx });
    expect(Math.round(sent[sent.length - 1]!)).toBe(296); // the CI screenshot's value
    pan.end({ y: DRAG_Y * scale, translationX: 201 });
    expect(sent[sent.length - 1]).toBe(MAX_X);
  });

  it("a gesture with no move at all still lands where the finger lifted", async () => {
    const { sent, pan } = await setup();
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.end({ y: DRAG_Y, translationX: -70 });
    expect(sent[sent.length - 1]).toBeCloseTo(CANVAS_W / 2 - 70, 5);
  });

  it("a lift at the last move's position commands nothing new", async () => {
    const { sent, pan } = await setup();
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.update({ y: DRAG_Y, translationX: 50 });
    const before = sent.length;
    pan.end({ y: DRAG_Y, translationX: 50 });
    expect(sent.length).toBe(before);
  });

  it("past the edge then back: the lift follows the overshoot re-anchor, not the raw translation", async () => {
    const { sent, pan } = await setup();
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.update({ y: DRAG_Y, translationX: 400 });
    expect(sent[sent.length - 1]).toBe(MAX_X);
    pan.end({ y: DRAG_Y, translationX: 300 });
    expect(sent[sent.length - 1]).toBeCloseTo(MAX_X - 100, 5);
  });

  it("a cancelled gesture does not apply its last translation", async () => {
    const { sent, pan } = await setup();
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.update({ y: DRAG_Y, translationX: 40 });
    const before = sent.length;
    pan.cancel({ y: DRAG_Y, translationX: 150 });
    expect(sent.length).toBe(before);
    expect(sent[sent.length - 1]).toBeCloseTo(CANVAS_W / 2 + 40, 5);
  });

  it("a lift while the autopilot has the ship (Extraction) commands nothing", async () => {
    const { sent, pan, game } = await setup();
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.update({ y: DRAG_Y, translationX: 30 });
    game.phase = "Extraction";
    const before = sent.length;
    pan.end({ y: DRAG_Y, translationX: 120 });
    expect(sent.length).toBe(before);
  });

  it("a lift after the ship was moved elsewhere carries on from where the ship is", async () => {
    const { sent, pan, game } = await setup();
    pan.begin({ y: DRAG_Y, translationX: 0 });
    pan.activate({ y: DRAG_Y, translationX: 0 });
    pan.update({ y: DRAG_Y, translationX: 30 });
    // The wave changed and the canvas re-centred the ship under the held finger.
    game.wave = 2;
    game.x = CANVAS_W / 2;
    pan.end({ y: DRAG_Y, translationX: 90 });
    // Re-anchored on the ship (as a move would be): the lift itself adds nothing.
    expect(sent[sent.length - 1]).toBeCloseTo(CANVAS_W / 2, 5);
  });

  it("a touch above the drag zone never moves the ship, even on lift", async () => {
    const { sent, pan } = await setup();
    pan.begin({ y: 1, translationX: 0 });
    pan.activate({ y: 1, translationX: 0 });
    pan.end({ y: 1, translationX: 120 });
    expect(sent).toEqual([]);
  });
});
