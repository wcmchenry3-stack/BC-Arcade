/// <reference types="jest" />
/**
 * Stand-ins for the Star Swarm canvas and audio hook, shared by the
 * StarSwarmScreen suites (#2957). Not a test file.
 *
 * The suite registers them from its jest.mock factories (the same module
 * instance is then the one the test imports). This module deliberately imports
 * nothing of the screen, so a mock factory can require it while the screen's own
 * imports are still being resolved; rendering helpers live in starSwarmHarness.
 *
 *   jest.mock("../../components/starswarm/GameCanvas", () =>
 *     require("./helpers/starSwarmMocks").canvasModule());
 *   jest.mock("../../hooks/useStarSwarmAudio", () =>
 *     require("./helpers/starSwarmMocks").audioModule());
 *
 * `canvas.props` holds the props the screen last gave the canvas (a test calls
 * its callbacks the way the game loop does); `canvas.handle` is the ref the
 * screen drives, as jest.fns; `canvas.state` is what `getState()` returns.
 */
import React from "react";
import { View } from "react-native";
import type { StarSwarmState } from "../../../game/starswarm/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
export const canvas: {
  props: any;
  state: StarSwarmState | null;
  handle: Record<string, jest.Mock>;
} = {
  props: null,
  state: null,
  handle: {},
};

function freshHandle() {
  return {
    getState: jest.fn(() => canvas.state),
    getFrameStats: jest.fn(() => null),
    triggerPowerUp: jest.fn(),
    throwAsteroid: jest.fn(),
    killEscorts: jest.fn(),
  };
}

/** One jest.fn per audio function the screen asks for, created on first use. */
export const audio: Record<string, jest.Mock> = new Proxy({} as Record<string, jest.Mock>, {
  get: (target, name: string) => (target[name] ??= jest.fn()),
});

/** The arguments of every `useStarSwarmAudio` call, oldest first. */
export const audioCalls: unknown[][] = [];

/** Clears the stand-ins between tests. */
export function resetHarness() {
  canvas.props = null;
  canvas.state = null;
  canvas.handle = freshHandle();
  for (const name of Object.keys(audio)) delete audio[name];
  audioCalls.length = 0;
}
resetHarness();

export function canvasModule() {
  const MockCanvas = React.forwardRef((props: any, ref: any) => {
    canvas.props = props;
    React.useImperativeHandle(ref, () => canvas.handle);
    return React.createElement(View, { testID: "starswarm-canvas" });
  });
  MockCanvas.displayName = "MockCanvas";
  return { __esModule: true, default: MockCanvas };
}

export function audioModule() {
  return {
    DEFAULT_SFX_VOLUMES: jest.requireActual("../../../hooks/useStarSwarmAudio").DEFAULT_SFX_VOLUMES,
    useStarSwarmAudio: (...args: unknown[]) => {
      audioCalls.push(args);
      return audio;
    },
  };
}
