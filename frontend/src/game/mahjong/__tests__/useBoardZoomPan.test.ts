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

async function setup(camera: Camera = CAMERA, reduce = false) {
  let current = camera;
  const hook = await renderHook(({ c, r }: { c: Camera; r: boolean }) => useBoardZoomPan(c, r), {
    initialProps: { c: camera, r: reduce },
  });
  const handlers = (kind: string): GestureHandlers =>
    gesturesOfKind(hook.result.current.boardGesture as unknown as RecordedGesture, kind)[0]!
      .handlers;
  // The mocked animated style is evaluated at render: re-render to read a write.
  const transform = async () => {
    await hook.rerender({ c: current, r: reduce });
    const t = (
      hook.result.current.gestureAnimStyle as unknown as { transform: Record<string, number>[] }
    ).transform;
    return { x: t[0]!.translateX!, y: t[1]!.translateY!, scale: t[2]!.scale! };
  };
  const setCamera = async (c: Camera) => {
    current = c;
    await hook.rerender({ c, r: reduce });
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

  describe("re-fit as tiles clear (#3612)", () => {
    // A 100 x 75 corner of the board: it would fit at 2x, so the zoom stops at the readable
    // limit (1.2); centring it asks for an offset of (180, 135), held to the pan bounds at
    // 1.2 (140, 105).
    const CORNER = { x: 0, y: 0, width: 100, height: 75 };
    const AT_CORNER = { x: 140, y: 105, scale: 1.2 };

    it("fits the rect, up to the readable zoom and inside the pan bounds", async () => {
      const { hook, transform } = await setup();
      let moved = false;
      await act(async () => {
        moved = hook.result.current.refit(CORNER, true);
      });
      expect(moved).toBe(true);
      const t = await transform();
      expect(t.scale).toBeCloseTo(AT_CORNER.scale, 5);
      expect(t.x).toBeCloseTo(AT_CORNER.x, 5);
      expect(t.y).toBeCloseTo(AT_CORNER.y, 5);
    });

    it("eases over 350 ms, and is instant under Reduce Motion", async () => {
      const timing = jest.spyOn(Reanimated, "withTiming").mockImplementation(((
        value: number,
        _cfg: unknown,
        done?: (finished: boolean) => void
      ) => {
        done?.(true);
        return value;
      }) as never);
      const { hook } = await setup();
      await act(async () => {
        hook.result.current.refit(CORNER, true);
      });
      expect(timing).not.toHaveBeenCalled();
      await act(async () => {
        hook.result.current.refit({ x: 0, y: 0, width: 400, height: 300 }, false);
      });
      expect(timing).toHaveBeenCalledTimes(3);
      for (const call of timing.mock.calls) {
        expect((call[1] as { duration: number }).duration).toBe(350);
      }
    });

    it("never moves during a pinch or pan", async () => {
      const { hook, transform } = await setup();
      for (const kind of ["pinch", "pan"]) {
        const g = gesturesOfKind(
          hook.result.current.boardGesture as unknown as RecordedGesture,
          kind
        )[0]!.handlers;
        await act(async () => {
          g.onStart!({});
        });
        let moved = true;
        await act(async () => {
          moved = hook.result.current.refit(CORNER, true);
        });
        expect(moved).toBe(false);
        expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.5 });
        await act(async () => {
          g.onEnd!({});
        });
      }
    });

    it("waits while the player has zoomed away, and follows again back at fit", async () => {
      const { hook, transform, pinchTo } = await setup();
      await pinchTo(1.6); // 0.8: neither the whole board nor the last fit
      let moved = true;
      await act(async () => {
        moved = hook.result.current.refit(CORNER, true);
      });
      expect(moved).toBe(false);
      expect((await transform()).scale).toBeCloseTo(0.8, 5);
      await pinchTo(0.001); // back to the whole board
      await act(async () => {
        moved = hook.result.current.refit(CORNER, true);
      });
      expect(moved).toBe(true);
      expect((await transform()).scale).toBeCloseTo(AT_CORNER.scale, 5);
    });

    it("keeps following after a gesture that ends where the last fit left it", async () => {
      const { hook, drag } = await setup();
      await act(async () => {
        hook.result.current.refit(CORNER, true);
      });
      await drag(0, 0);
      let moved = false;
      await act(async () => {
        moved = hook.result.current.refit({ x: 0, y: 0, width: 400, height: 300 }, true);
      });
      expect(moved).toBe(true);
    });

    it("fitToScreen follows the remaining tiles again after a hand zoom", async () => {
      const { hook, pinchTo } = await setup();
      await pinchTo(1.6);
      await act(async () => {
        hook.result.current.fitToScreen(true);
      });
      let moved = false;
      await act(async () => {
        moved = hook.result.current.refit(CORNER, true);
      });
      expect(moved).toBe(true);
    });
  });

  describe("double-tap (#3612)", () => {
    const doubleTap = (hook: Awaited<ReturnType<typeof setup>>["hook"], x: number, y: number) =>
      act(async () => {
        gesturesOfKind(hook.result.current.boardGesture as unknown as RecordedGesture, "tap")[0]!
          .handlers.onEnd!({ x, y });
      });

    it("is a tap gesture alongside the pinch and pan", async () => {
      const { hook } = await setup();
      const gesture = hook.result.current.boardGesture as unknown as RecordedGesture;
      expect(gesture.kind).toBe("simultaneous");
      expect(gesturesOfKind(gesture, "tap")).toHaveLength(1);
    });

    it("at fit, zooms to readable tiles centred on the tap, inside the pan bounds", async () => {
      const { hook, transform } = await setup();
      // Board point (250, 160) is 50 right and 10 below the centre: at 1.2 the offset is
      // (-60, -12), well inside the bounds (140, 105).
      await doubleTap(hook, 250, 160);
      const t = await transform();
      expect(t.scale).toBeCloseTo(1.2, 5);
      expect(t.x).toBeCloseTo(-60, 5);
      expect(t.y).toBeCloseTo(-12, 5);
    });

    it("zoomed in, goes back to the fitted view and follows the tiles again", async () => {
      const { hook, transform } = await setup();
      await doubleTap(hook, 250, 160);
      let moved = true;
      await act(async () => {
        moved = hook.result.current.refit({ x: 0, y: 0, width: 100, height: 75 }, true);
      });
      expect(moved).toBe(false); // zoomed in by the double-tap: auto-fit waits
      await doubleTap(hook, 10, 10);
      expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.5 });
      await act(async () => {
        moved = hook.result.current.refit({ x: 0, y: 0, width: 100, height: 75 }, true);
      });
      expect(moved).toBe(true);
    });

    it("is instant under Reduce Motion", async () => {
      const timing = jest.spyOn(Reanimated, "withTiming");
      const { hook } = await setup(CAMERA, true);
      timing.mockClear();
      await doubleTap(hook, 250, 160);
      expect(timing).not.toHaveBeenCalled();
    });
  });

  describe("mini-map support (#3612)", () => {
    it("reports zoomedIn past the fitted view, after a pinch or a double-tap, and not at fit", async () => {
      const { hook, pinchTo } = await setup();
      expect(hook.result.current.zoomedIn).toBe(false);
      await pinchTo(1.6);
      expect(hook.result.current.zoomedIn).toBe(true);
      await pinchTo(0.001);
      expect(hook.result.current.zoomedIn).toBe(false);
      await act(async () => {
        gesturesOfKind(hook.result.current.boardGesture as unknown as RecordedGesture, "tap")[0]!
          .handlers.onEnd!({ x: 200, y: 150 });
      });
      expect(hook.result.current.zoomedIn).toBe(true);
      await act(async () => {
        hook.result.current.fitToScreen(true);
      });
      expect(hook.result.current.zoomedIn).toBe(false);
    });

    it("panTo centres a board point at the current zoom and pauses auto-fit", async () => {
      const { hook, transform, pinchTo } = await setup();
      await pinchTo(2); // 1.0
      await act(async () => {
        hook.result.current.panTo(250, 160);
      });
      const t = await transform();
      expect(t.scale).toBeCloseTo(1, 5);
      expect(t.x).toBeCloseTo(-50, 5);
      expect(t.y).toBeCloseTo(-10, 5);
      let moved = true;
      await act(async () => {
        moved = hook.result.current.refit({ x: 0, y: 0, width: 400, height: 300 }, true);
      });
      expect(moved).toBe(false);
    });
  });
  describe("review fixes (#3612)", () => {
    it("resets to fit on a new deal of the same layout", async () => {
      const hook = await renderHook(({ k }: { k: string }) => useBoardZoomPan(CAMERA, true, k), {
        initialProps: { k: "deal-1" },
      });
      const pinch = gesturesOfKind(
        hook.result.current.boardGesture as unknown as RecordedGesture,
        "pinch"
      )[0]!.handlers;
      await act(async () => {
        pinch.onUpdate!({ scale: 1000 });
        pinch.onEnd!();
      });
      expect(hook.result.current.zoomedIn).toBe(true);
      await hook.rerender({ k: "deal-2" });
      await hook.rerender({ k: "deal-2" });
      const t = (
        hook.result.current.gestureAnimStyle as unknown as { transform: Record<string, number>[] }
      ).transform;
      expect(t[2]!.scale).toBe(0.5);
      expect(hook.result.current.zoomedIn).toBe(false);
    });

    it("a gesture started mid-animation stops it and starts from the view on screen", async () => {
      // An animation that never finishes: the settled gesture origin stays at the old view.
      jest.spyOn(Reanimated, "withTiming").mockImplementation(((value: number) => value) as never);
      const cancel = jest.spyOn(Reanimated, "cancelAnimation");
      const { hook, transform } = await setup();
      await act(async () => {
        hook.result.current.zoomAt(400, 300); // to 1.2 on the bottom-right corner
      });
      const before = await transform();
      expect(before.scale).toBeCloseTo(1.2, 5);
      const pan = gesturesOfKind(
        hook.result.current.boardGesture as unknown as RecordedGesture,
        "pan"
      )[0]!.handlers;
      await act(async () => {
        pan.onStart!({});
        pan.onUpdate!({ translationX: 10, translationY: 0 });
      });
      expect(cancel).toHaveBeenCalled();
      const t = await transform();
      expect(t.x).toBeCloseTo(Math.min(140, before.x + 10), 5);
      expect(t.y).toBeCloseTo(before.y, 5);
      expect(t.scale).toBeCloseTo(1.2, 5);
    });

    it("a pinch that outlasts the pan it began as still holds the camera", async () => {
      const { hook } = await setup();
      const CORNER = { x: 0, y: 0, width: 100, height: 75 };
      const pan = gesturesOfKind(
        hook.result.current.boardGesture as unknown as RecordedGesture,
        "pan"
      )[0]!.handlers;
      const pinch = gesturesOfKind(
        hook.result.current.boardGesture as unknown as RecordedGesture,
        "pinch"
      )[0]!.handlers;
      let moved = true;
      await act(async () => {
        pan.onStart!({});
        pinch.onStart!({});
        pan.onEnd!({});
        moved = hook.result.current.refit(CORNER, true);
      });
      expect(moved).toBe(false);
      await act(async () => {
        pinch.onEnd!({});
        moved = hook.result.current.refit(CORNER, true);
      });
      expect(moved).toBe(true);
    });

    it("ignores a double-tap the recogniser did not accept", async () => {
      const { hook, transform } = await setup();
      await act(async () => {
        gesturesOfKind(hook.result.current.boardGesture as unknown as RecordedGesture, "tap")[0]!
          .handlers.onEnd!({ x: 200, y: 150 }, false);
      });
      expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.5 });
    });
    it("ignores two quick taps far apart (a match on two tiles)", async () => {
      const { hook, transform } = await setup();
      const tap = gesturesOfKind(
        hook.result.current.boardGesture as unknown as RecordedGesture,
        "tap"
      )[0]!.handlers;
      await act(async () => {
        tap.onBegin!({});
        tap.onTouchesDown!({ changedTouches: [{ x: 40, y: 40 }] });
        tap.onTouchesDown!({ changedTouches: [{ x: 300, y: 200 }] });
        tap.onEnd!({ x: 300, y: 200 }, true);
      });
      expect(await transform()).toEqual({ x: 0, y: 0, scale: 0.5 });
      await act(async () => {
        tap.onBegin!({});
        tap.onTouchesDown!({ changedTouches: [{ x: 200, y: 150 }] });
        tap.onTouchesDown!({ changedTouches: [{ x: 210, y: 155 }] });
        tap.onEnd!({ x: 210, y: 155 }, true);
      });
      expect((await transform()).scale).toBeCloseTo(1.2, 5);
    });
  });
});
