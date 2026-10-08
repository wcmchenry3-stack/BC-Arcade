/**
 * useBoardZoomPan (#2981): the board's pinch zoom stays between fitted and the
 * readable-tile limit, the pan stays inside the zoomed board's edges, a new
 * camera resets both, and fitToScreen returns to fitted and centred.
 */
import { act, renderHook } from "@testing-library/react-native";
import * as Reanimated from "react-native-reanimated";

import type { GestureHandlers, RecordedGesture } from "../../../test-utils/mockScreenDeps";
import { gesturesOfKind } from "../../../test-utils/mockScreenDeps";
import { useBoardZoomPan } from "../useBoardZoomPan";

jest.mock("react-native-gesture-handler", () => mockScreenDeps().mockGestureHandler(() => []));

// Fitted at 0.5; the readable-tile limit is 48 / 40 = 1.2. At 1.2 the
// 400 x 300 board overflows the 200 x 150 viewport by 140 / 105 a side.
const CAMERA = {
  scale: 0.5,
  tileWidth: 40,
  boardWidth: 400,
  boardHeight: 300,
  viewportWidth: 200,
  viewportHeight: 150,
};
type Camera = typeof CAMERA;

afterEach(() => {
  jest.restoreAllMocks();
});

async function setup(camera: Camera = CAMERA) {
  let current = camera;
  const hook = await renderHook(({ c }: { c: Camera }) => useBoardZoomPan(c), {
    initialProps: { c: camera },
  });
  const handlers = (kind: string): GestureHandlers =>
    gesturesOfKind(hook.result.current.boardGesture as unknown as RecordedGesture, kind)[0]!
      .handlers;
  // The mocked animated style is evaluated at render: re-render to read a write.
  const transform = async () => {
    await hook.rerender({ c: current });
    const t = (hook.result.current.gestureAnimStyle as { transform: Record<string, number>[] })
      .transform;
    return { x: t[0]!.translateX!, y: t[1]!.translateY!, scale: t[2]!.scale! };
  };
  const setCamera = async (c: Camera) => {
    current = c;
    await hook.rerender({ c });
  };
  const pinchTo = async (factor: number) => {
    await act(async () => {
      handlers("pinch").onUpdate!({ scale: factor });
      handlers("pinch").onEnd!();
    });
  };
  const drag = async (dx: number, dy: number) => {
    await act(async () => {
      handlers("pan").onUpdate!({ translationX: dx, translationY: dy });
      handlers("pan").onEnd!();
    });
  };
  return { hook, transform, setCamera, pinchTo, drag };
}

describe("useBoardZoomPan", () => {
  it("starts fitted, centred, as a pinch and a pan together", async () => {
    const { hook, transform } = await setup();
    expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.5 });
    const gesture = hook.result.current.boardGesture as unknown as RecordedGesture;
    expect(gesture.kind).toBe("simultaneous");
    expect(gesturesOfKind(gesture, "pinch")).toHaveLength(1);
    expect(gesturesOfKind(gesture, "pan")).toHaveLength(1);
  });

  it("zooms between fitted and the readable-tile limit", async () => {
    const { transform, pinchTo } = await setup();
    await pinchTo(2);
    expect((await transform()).scale).toBeCloseTo(1, 5);
    // The next pinch starts from where the last one ended.
    await pinchTo(1000);
    expect((await transform()).scale).toBeCloseTo(1.2, 5);
    await pinchTo(0.0001);
    expect((await transform()).scale).toBeCloseTo(0.5, 5);
  });

  it("does not pan a fitted board", async () => {
    const { transform, drag } = await setup();
    await drag(50, -50);
    const t = await transform();
    expect(t.x).toBeCloseTo(0, 5);
    expect(t.y).toBeCloseTo(0, 5);
  });

  it("pans a zoomed board up to its edges and keeps the offset between drags", async () => {
    const { transform, pinchTo, drag } = await setup();
    await pinchTo(1000);
    await drag(30, -20);
    expect(await transform()).toMatchObject({ x: 30, y: -20 });
    await drag(30, -20);
    expect(await transform()).toMatchObject({ x: 60, y: -40 });
    await drag(10_000, -10_000);
    expect(await transform()).toMatchObject({ x: 140, y: -105 });
  });

  it("pulls the offset back inside the edges when zooming out", async () => {
    const { transform, pinchTo, drag } = await setup();
    await pinchTo(1000);
    await drag(10_000, 10_000);
    await pinchTo(0.0001);
    const t = await transform();
    expect(t.x).toBeCloseTo(0, 5);
    expect(t.y).toBeCloseTo(0, 5);
  });

  it("resets to fitted and centred when the camera's fit changes", async () => {
    const { transform, setCamera, pinchTo, drag } = await setup();
    await pinchTo(1000);
    await drag(50, 50);
    await setCamera({ ...CAMERA, scale: 0.25 });
    expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.25 });
  });

  it("measures the pan against the latest board and viewport sizes", async () => {
    const { transform, setCamera, pinchTo, drag } = await setup();
    // A wider viewport, same fit: at 1.2 the board overflows by (480 - 300) / 2 = 90.
    await setCamera({ ...CAMERA, viewportWidth: 300 });
    await pinchTo(1000);
    await drag(10_000, 0);
    expect((await transform()).x).toBeCloseTo(90, 5);
  });

  it("fitToScreen snaps back at once under Reduce Motion", async () => {
    const { hook, transform, pinchTo, drag } = await setup();
    await pinchTo(1000);
    await drag(40, 40);
    await act(async () => {
      hook.result.current.fitToScreen(true);
    });
    expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.5 });
    // The next pinch starts from fitted, not from the old zoom.
    await pinchTo(2);
    expect((await transform()).scale).toBeCloseTo(1, 5);
  });

  it("fitToScreen animates back over 350 ms, settling the gesture origin at the end", async () => {
    const timing = jest.spyOn(Reanimated, "withTiming").mockImplementation(((
      value: number,
      _cfg: unknown,
      done?: (finished: boolean) => void
    ) => {
      done?.(true);
      return value;
    }) as never);
    const { hook, transform, pinchTo, drag } = await setup();
    await pinchTo(1000);
    await drag(40, 40);
    await act(async () => {
      hook.result.current.fitToScreen(false);
    });
    expect(timing).toHaveBeenCalledTimes(3);
    for (const call of timing.mock.calls) {
      expect((call[1] as { duration: number }).duration).toBe(350);
    }
    expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.5 });
    // The gesture origin settled too: the next pinch and drag start from fitted.
    await pinchTo(2);
    expect((await transform()).scale).toBeCloseTo(1, 5);
    await drag(10, 0);
    expect((await transform()).x).toBeCloseTo(10, 5);
  });
});
