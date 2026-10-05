/**
 * #2956: Star Swarm's control overlay, by what the player sees and does — the pause card and its
 * buttons, tap-to-pause in the top of the field, the haptic helpers and the arrow-key loop (web
 * and external keyboards). Drag-to-move is covered through the real engine in
 * Controls.edgeDrag.test.tsx.
 */
import React from "react";
import { Platform } from "react-native";
import { cleanup, fireEvent, render, screen } from "@testing-library/react-native";
import * as Haptics from "expo-haptics";

import Controls, { hapticPlayerHit, hapticWaveClear } from "../Controls";
import type { GameCanvasHandle } from "../GameCanvas";
import { CANVAS_H, CANVAS_W, PLAYER_W } from "../../../game/starswarm/engine";
import { detectedGesture } from "../../../test-utils/mockScreenDeps";
import type { DetectorRender } from "../../../test-utils/mockScreenDeps";

jest.mock("expo-haptics", () => ({
  impactAsync: jest.fn(() => Promise.resolve()),
  notificationAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: "light" },
  NotificationFeedbackType: { Success: "success" },
}));

// Every GestureDetector render records the gesture it was given (src/test-utils/mockScreenDeps.ts).
const mockDetected: DetectorRender[] = [];
jest.mock("react-native-gesture-handler", () =>
  mockScreenDeps().mockGestureHandler(() => mockDetected)
);
/** The Pan of the most recently rendered Controls. */
const pan = () => detectedGesture(mockDetected, "pan")!;
beforeEach(() => {
  mockDetected.length = 0;
});

const SCALE = 1;
const TOP_Y = 50; // well inside the top 60% (tap-to-pause zone)
const BOTTOM_Y = CANVAS_H - 20; // the drag zone

function handle(): GameCanvasHandle {
  return {
    setPlayerX: jest.fn(),
    getPlayerX: jest.fn(() => CANVAS_W / 2),
    getState: jest.fn(() => ({ wave: 1, phase: "Playing", player: { x: CANVAS_W / 2 } })),
  } as unknown as GameCanvasHandle;
}

async function mount(props: Partial<React.ComponentProps<typeof Controls>> = {}) {
  const cb = { onPause: jest.fn(), onResume: jest.fn(), onNewGame: jest.fn() };
  const canvasRef = { current: handle() };
  await render(
    <Controls canvasRef={canvasRef} scale={SCALE} isLiveRun isPaused={false} {...cb} {...props} />
  );
  return { ...cb, canvasRef };
}

function tapAt(y: number, translationX = 0) {
  pan().onBegin!({ y });
  pan().onEnd!({ y, translationX });
  pan().onFinalize!({});
}

describe("Star Swarm Controls — pause card", () => {
  it("is hidden during play", async () => {
    await mount();
    expect(screen.queryByText("PAUSED")).toBeNull();
  });

  it("is hidden when no run is live, even if paused", async () => {
    await mount({ isPaused: true, isLiveRun: false });
    expect(screen.queryByText("PAUSED")).toBeNull();
  });

  it("offers resume (the backdrop and the button) and a new game while paused", async () => {
    const cb = await mount({ isPaused: true });
    expect(screen.getByText("PAUSED")).toBeTruthy();
    const resumes = screen.getAllByRole("button", { name: "Resume game" });
    expect(resumes).toHaveLength(2);
    for (const r of resumes) await fireEvent.press(r);
    expect(cb.onResume).toHaveBeenCalledTimes(2);
    await fireEvent.press(
      screen.getByRole("button", { name: "Discard saved game and start a new game" })
    );
    expect(cb.onNewGame).toHaveBeenCalledTimes(1);
    expect(screen.getByText("RESUME")).toBeTruthy();
    expect(screen.getByText("NEW GAME")).toBeTruthy();
  });
});

describe("Star Swarm Controls — tap to pause", () => {
  it("a short tap in the top of the field pauses a live run", async () => {
    const cb = await mount();
    tapAt(TOP_Y);
    expect(cb.onPause).toHaveBeenCalledTimes(1);
  });

  it("a swipe, a tap in the drag zone, a paused game or a finished run does not pause", async () => {
    const live = await mount();
    tapAt(TOP_Y, 40); // a swipe, not a tap
    tapAt(BOTTOM_Y); // the drag zone moves the ship instead
    expect(live.onPause).not.toHaveBeenCalled();

    const paused = await mount({ isPaused: true });
    tapAt(TOP_Y);
    expect(paused.onPause).not.toHaveBeenCalled();

    const over = await mount({ isLiveRun: false });
    tapAt(TOP_Y);
    expect(over.onPause).not.toHaveBeenCalled();
  });

  it("a touch in the drag zone moves the ship, not the pause state", async () => {
    const { canvasRef, onPause } = await mount();
    pan().onBegin!({ y: BOTTOM_Y });
    pan().onChange!({ translationX: 20 });
    pan().onEnd!({ y: BOTTOM_Y, translationX: 20 });
    expect(canvasRef.current.setPlayerX).toHaveBeenLastCalledWith(CANVAS_W / 2 + 20);
    expect(onPause).not.toHaveBeenCalled();
  });
});

describe("Star Swarm Controls — haptics", () => {
  it("a hit is a light impact; a wave clear a success notification", () => {
    hapticPlayerHit();
    hapticWaveClear();
    expect(Haptics.impactAsync).toHaveBeenCalledWith("light");
    expect(Haptics.notificationAsync).toHaveBeenCalledWith("success");
  });

  it("swallows a haptics failure (no engine on the device)", async () => {
    (Haptics.impactAsync as jest.Mock).mockReturnValueOnce(Promise.reject(new Error("no")));
    (Haptics.notificationAsync as jest.Mock).mockReturnValueOnce(Promise.reject(new Error("no")));
    expect(() => {
      hapticPlayerHit();
      hapticWaveClear();
    }).not.toThrow();
    await Promise.resolve();
  });
});

describe("Star Swarm Controls — arrow keys (web)", () => {
  type KeyHandler = (e: { key: string; preventDefault: () => void }) => void;
  let listeners: Record<string, KeyHandler>;
  let frame: (() => void) | null;
  const g = globalThis as unknown as Record<string, unknown>;
  const saved: Record<string, unknown> = {};

  beforeEach(() => {
    jest.replaceProperty(Platform, "OS", "web");
    listeners = {};
    frame = null;
    for (const k of ["window", "requestAnimationFrame", "cancelAnimationFrame"]) saved[k] = g[k];
    g.window = {
      addEventListener: jest.fn((type: string, fn: KeyHandler) => (listeners[type] = fn)),
      removeEventListener: jest.fn((type: string) => delete listeners[type]),
    };
    g.requestAnimationFrame = jest.fn((cb: () => void) => {
      frame = cb;
      return 7;
    });
    g.cancelAnimationFrame = jest.fn();
  });
  afterEach(async () => {
    await cleanup(); // unmount while the fake window is still in place
    jest.restoreAllMocks();
    for (const k of Object.keys(saved)) g[k] = saved[k];
  });

  const step = (n = 1) => {
    for (let i = 0; i < n; i++) frame!();
  };

  it("holding an arrow moves the ship 6 px a frame, clamped to the field", async () => {
    const { canvasRef } = await mount();
    const preventDefault = jest.fn();
    listeners.keydown!({ key: "ArrowRight", preventDefault });
    expect(preventDefault).toHaveBeenCalled();
    step(2);
    expect(canvasRef.current.setPlayerX).toHaveBeenLastCalledWith(CANVAS_W / 2 + 12);
    listeners.keyup!({ key: "ArrowRight", preventDefault });
    (canvasRef.current.setPlayerX as jest.Mock).mockClear();
    step(3);
    expect(canvasRef.current.setPlayerX).not.toHaveBeenCalled();

    listeners.keydown!({ key: "ArrowLeft", preventDefault });
    step(100);
    expect(canvasRef.current.setPlayerX).toHaveBeenLastCalledWith(PLAYER_W / 2);
  });

  it("ignores other keys and both arrows at once", async () => {
    const { canvasRef } = await mount();
    const preventDefault = jest.fn();
    listeners.keydown!({ key: "a", preventDefault });
    expect(preventDefault).not.toHaveBeenCalled();
    step();
    listeners.keydown!({ key: "ArrowLeft", preventDefault });
    listeners.keydown!({ key: "ArrowRight", preventDefault });
    step();
    expect(canvasRef.current.setPlayerX).not.toHaveBeenCalled();
  });

  it("removes its listeners and stops the loop on unmount", async () => {
    await mount();
    expect(Object.keys(listeners).sort()).toEqual(["keydown", "keyup"]);
    await screen.unmount();
    expect(listeners).toEqual({});
    expect(g.cancelAnimationFrame).toHaveBeenCalledWith(7);
  });
});
