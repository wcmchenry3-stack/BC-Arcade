/**
 * #3684 render diagnostics (renderDiag.ts): the variants' canvas plans, the test-build gate
 * (outside a test build the variant is always "a" and nothing is recorded), the readout text,
 * and the deal-in counters useBoardMotion feeds.
 */
import { act, renderHook } from "@testing-library/react-native";

import {
  canvasPixels,
  canvasPlan,
  diagSnapshot,
  formatDiag,
  getRenderVariant,
  noteCanvas,
  noteDealSkipped,
  noteDealStart,
  noteDealTimerFired,
  noteFaceRaster,
  resetRenderDiag,
  setRenderVariant,
  useRenderVariant,
} from "../renderDiag";
import type { DiagLive } from "../renderDiag";
import { createGame } from "../engine";
import { getLayout } from "../layouts/registry";
import type { BoardCamera } from "../layout";
import type { MahjongState } from "../types";
import { useBoardMotion } from "../useBoardMotion";
import { DEAL_IN_MS } from "../motion";

const ORIGINAL = process.env.EXPO_PUBLIC_TEST_HOOKS;
const hooksOn = () => {
  process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
};
const hooksOff = () => {
  delete process.env.EXPO_PUBLIC_TEST_HOOKS;
};

beforeEach(() => {
  hooksOn();
  resetRenderDiag();
});

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL;
  resetRenderDiag();
});

describe("canvasPlan", () => {
  it("a: today's renderer — canvas and tiles at res, the View scales it back by 1/res", () => {
    expect(canvasPlan("a", 2.5)).toEqual({
      tileRes: 2.5,
      canvasScale: 2.5,
      viewScale: 1 / 2.5,
      faceRes: 2.5,
    });
  });

  it("b: resolution 1 everywhere, no View scale", () => {
    expect(canvasPlan("b", 2.5)).toEqual({
      tileRes: 1,
      canvasScale: 1,
      viewScale: 1,
      faceRes: 1,
    });
  });

  it("c: canvas at board size, no View scale, faces keep res", () => {
    expect(canvasPlan("c", 2.5)).toEqual({
      tileRes: 1,
      canvasScale: 1,
      viewScale: 1,
      faceRes: 2.5,
    });
  });

  it("canvasPixels: the canvas's physical size", () => {
    // Turtle on a 3x phone at res 2: about 2400 x 4800 px in variant a.
    expect(canvasPixels(canvasPlan("a", 2), 400, 800, 3)).toEqual({ width: 2400, height: 4800 });
    expect(canvasPixels(canvasPlan("b", 2), 400, 800, 3)).toEqual({ width: 1200, height: 2400 });
    expect(canvasPixels(canvasPlan("c", 2), 400, 800, 3)).toEqual({ width: 1200, height: 2400 });
  });
});

describe("the test-build gate", () => {
  it("in a test build the chosen variant holds", () => {
    expect(getRenderVariant()).toBe("a");
    setRenderVariant("c");
    expect(getRenderVariant()).toBe("c");
  });

  it("useRenderVariant follows a pick in a test build", async () => {
    const hook = await renderHook(() => useRenderVariant());
    expect(hook.result.current).toBe("a");
    await act(async () => {
      setRenderVariant("c");
    });
    expect(hook.result.current).toBe("c");
  });

  it("useRenderVariant stays a and never re-renders when the flag is off", async () => {
    hooksOff();
    let renders = 0;
    const hook = await renderHook(() => {
      renders += 1;
      return useRenderVariant();
    });
    const before = renders;
    await act(async () => {
      setRenderVariant("b");
    });
    expect(hook.result.current).toBe("a");
    expect(renders).toBe(before);
  });

  it("outside a test build the variant is always a, whatever was picked", () => {
    setRenderVariant("b");
    hooksOff();
    expect(getRenderVariant()).toBe("a");
    setRenderVariant("c");
    hooksOn();
    // The pick made with hooks off was ignored.
    expect(getRenderVariant()).toBe("b");
  });

  it("outside a test build nothing is recorded", () => {
    hooksOff();
    noteDealStart({ value: 0.5 });
    noteDealTimerFired();
    noteDealSkipped();
    noteFaceRaster({ key: "k", ms: 1, ready: 1, nulls: 0 });
    noteCanvas({
      variant: "a",
      res: 2,
      plan: canvasPlan("a", 2),
      boardWidth: 1,
      boardHeight: 1,
      facesReady: 1,
    });
    expect(diagSnapshot()).toEqual({
      dealsStarted: 0,
      dealTimersFired: 0,
      dealsSkipped: 0,
      dealProgress: null,
      lastRaster: null,
      rasters: 0,
      canvas: null,
    });
  });
});

describe("formatDiag", () => {
  const live: DiagLive = {
    pixelRatio: 3,
    motionTiles: 144,
    dealing: true,
    reduceMotion: false,
    jsMs: 20500,
    uiFrames: null,
  };

  it("before any canvas or deal", () => {
    expect(formatDiag(diagSnapshot(), live)).toEqual([
      "v=? (no canvas yet) pr=3",
      "motion=144 dealing=Y p=-",
      "deals=0 dealTimer=0 skip=0",
      "ui=off js=20.5s",
      "faces drawn=- raster#0 -",
      "reduceMotion=off",
    ]);
  });

  it("reads the deal's progress now, and every counter", () => {
    const progress = { value: 0.04 };
    noteDealStart(progress);
    progress.value = 0.125;
    noteDealTimerFired();
    noteDealSkipped();
    noteFaceRaster({ key: "30x40@6", ms: 812.4, ready: 41, nulls: 1 });
    noteCanvas({
      variant: "a",
      res: 2,
      plan: canvasPlan("a", 2),
      boardWidth: 390,
      boardHeight: 700,
      facesReady: -1,
    });
    expect(formatDiag(diagSnapshot(), { ...live, uiFrames: 61, reduceMotion: true })).toEqual([
      "v=a res=2.00 pr=3 canvas=2340x4200px",
      "motion=144 dealing=Y p=0.125",
      "deals=1 dealTimer=1 skip=1",
      "ui=61f js=20.5s",
      "faces drawn=none raster#1 41ok/1null 812ms 30x40@6",
      "reduceMotion=ON",
    ]);
  });

  it("a progress that throws on read shows NaN, never breaks the readout", () => {
    noteDealStart({
      get value(): number {
        throw new Error("gone");
      },
    });
    expect(formatDiag(diagSnapshot(), live)[1]).toBe("motion=144 dealing=Y p=NaN");
  });
});

describe("useBoardMotion feeds the deal counters (test builds)", () => {
  const camera: BoardCamera = {
    tileToScreen: (col, row, layer) => ({ x: col * 10 + layer * 4, y: row * 30 - layer * 4 }),
    tileWidth: 22,
    tileHeight: 32,
    faceWidth: 18,
    faceHeight: 28,
    sideWidth: 4,
    boardWidth: 400,
    boardHeight: 300,
    scale: 1,
    offsetX: 0,
    offsetY: 0,
    viewportWidth: 400,
    viewportHeight: 300,
  };
  const NO_HINT: ReadonlySet<number> = new Set();
  type Props = { s: MahjongState | null };

  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  async function dealt() {
    const hook = await renderHook(({ s }: Props) => useBoardMotion(s, NO_HINT, camera, false), {
      initialProps: { s: null as MahjongState | null },
    });
    const next = createGame(getLayout("turtle"), 4);
    await act(async () => {
      hook.result.current.dealIn(next);
    });
    await hook.rerender({ s: next });
    return hook;
  }

  it("counts the deal's start and its end timer", async () => {
    await dealt();
    expect(diagSnapshot()).toMatchObject({ dealsStarted: 1, dealTimersFired: 0 });
    expect(diagSnapshot().dealProgress).not.toBeNull();
    await act(async () => {
      jest.advanceTimersByTime(DEAL_IN_MS);
    });
    expect(diagSnapshot()).toMatchObject({ dealsStarted: 1, dealTimersFired: 1, dealsSkipped: 0 });
  });

  it("counts a skipped deal", async () => {
    const hook = await dealt();
    await act(async () => {
      hook.result.current.skipDeal();
    });
    expect(diagSnapshot().dealsSkipped).toBe(1);
  });

  it("records nothing outside a test build", async () => {
    hooksOff();
    await dealt();
    await act(async () => {
      jest.advanceTimersByTime(DEAL_IN_MS);
    });
    expect(diagSnapshot()).toMatchObject({ dealsStarted: 0, dealTimersFired: 0 });
  });
});
