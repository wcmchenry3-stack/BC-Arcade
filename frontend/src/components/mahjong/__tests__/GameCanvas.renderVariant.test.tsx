/**
 * #3684: the native canvas's render variants (renderDiag.ts). Outside a test build it always
 * draws variant "b", the fixed renderer, whatever was picked: a canvas at the board's size, no
 * View downscale, faces at PixelRatio x 1. In a test build "a" is the OLD oversized canvas
 * (#3611, for the before/after demo) and "c" is b with faces at PixelRatio x res. Skia is
 * stubbed with host Views that keep their props.
 */
import React from "react";
import { act, render, screen } from "@testing-library/react-native";
import { PixelRatio, StyleSheet } from "react-native";
import { Skia } from "@shopify/react-native-skia";

import GameCanvas from "../GameCanvas";
import { resetTileFaces } from "../tileFaces";
import { createGame } from "../../../game/mahjong/engine";
import { TURTLE_LAYOUT } from "../../../game/mahjong/layouts/turtle";
import type { BoardCamera } from "../../../game/mahjong/layout";
import type { MahjongState, SlotTile } from "../../../game/mahjong/types";
import { boardResolution } from "../../../game/mahjong/zoom";
import { diagSnapshot, resetRenderDiag, setRenderVariant } from "../../../game/mahjong/renderDiag";

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const host = (name: string) => {
    const Host = ({ children, ...props }: { children?: React.ReactNode }) =>
      createElement(View, { testID: `sk-${name}`, ...props }, children);
    Host.displayName = `Sk${name}`;
    return Host;
  };
  return {
    Canvas: host("canvas"),
    Fill: host("fill"),
    Group: host("group"),
    Rect: host("rect"),
    Image: host("image"),
    BlurMask: host("blur"),
    Path: host("path"),
    loadData: jest.fn((source: unknown, factory: (d: unknown) => unknown) =>
      Promise.resolve(factory(source))
    ),
    Skia: {
      SVG: { MakeFromData: jest.fn((src: unknown) => ({ svg: src })) },
      Surface: {
        Make: jest.fn((width: number, height: number) => ({
          getCanvas: () => ({ scale: jest.fn(), drawSvg: jest.fn() }),
          flush: jest.fn(),
          makeImageSnapshot: () => ({ width, height, dispose: jest.fn() }),
          dispose: jest.fn(),
        })),
      },
    },
  };
});

const mockRaster = Skia.Surface.Make as unknown as jest.Mock;

const camera: BoardCamera = {
  tileToScreen: (col, row, layer) => ({ x: 10 + col * 10 + layer * 4, y: 10 + row * 30 }),
  tileWidth: 22,
  tileHeight: 32,
  faceWidth: 18,
  faceHeight: 28,
  sideWidth: 4,
  boardWidth: 200,
  boardHeight: 160,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  viewportWidth: 200,
  viewportHeight: 160,
};
const TILES: SlotTile[] = [
  { id: 0, suit: "circles", rank: 1, faceId: 17, col: 0, row: 0, layer: 0 },
  { id: 1, suit: "circles", rank: 1, faceId: 17, col: 4, row: 0, layer: 0 },
];
const state: MahjongState = { ...createGame(TURTLE_LAYOUT, 1), tiles: TILES, selected: null };
const RES = boardResolution(camera.scale, camera.tileWidth);

const ORIGINAL = process.env.EXPO_PUBLIC_TEST_HOOKS;

async function mount() {
  await render(<GameCanvas state={state} camera={camera} onTilePress={jest.fn()} />);
  await act(() => {
    jest.runOnlyPendingTimers();
  });
}

function drawn() {
  const canvas = screen.getByTestId("sk-canvas");
  return {
    canvas: canvas.props.style,
    frame: StyleSheet.flatten(canvas.parent!.props.style),
    tileTransforms: screen.getAllByTestId("sk-group").map((g) => g.props.transform),
  };
}

/** The face bitmap's pixel size at `faceRes` times the device pixel ratio. */
function rasterSize(faceRes: number) {
  const px = PixelRatio.get() * faceRes;
  return [Math.ceil((18 - 4) * px), Math.ceil((28 - 4) * px)];
}

beforeEach(() => {
  resetTileFaces();
  resetRenderDiag();
  jest.clearAllMocks();
  jest.useFakeTimers();
  process.env.EXPO_PUBLIC_TEST_HOOKS = "1";
});

afterEach(() => {
  jest.useRealTimers();
  if (ORIGINAL === undefined) delete process.env.EXPO_PUBLIC_TEST_HOOKS;
  else process.env.EXPO_PUBLIC_TEST_HOOKS = ORIGINAL;
  resetRenderDiag();
});

/** The OLD renderer (#3611, test builds only): an oversized canvas the View scales back down. */
function expectVariantA() {
  const { canvas, frame, tileTransforms } = drawn();
  expect(canvas).toEqual({ width: 200 * RES, height: 160 * RES });
  expect(frame).toEqual({
    position: "absolute",
    width: 200 * RES,
    height: 160 * RES,
    left: (200 - 200 * RES) / 2,
    top: (160 - 160 * RES) / 2,
    transform: [{ scale: 1 / RES }],
  });
  for (const t of tileTransforms) expect(t).toEqual([{ scale: RES }]);
  expect(mockRaster).toHaveBeenCalledWith(...rasterSize(RES));
}

/** The fixed renderer (#3684): board-size canvas, no View downscale, faces at PixelRatio x 1. */
function expectFixed() {
  const { canvas, frame, tileTransforms } = drawn();
  expect(canvas).toEqual({ width: 200, height: 160 });
  expect(frame).toMatchObject({ width: 200, height: 160, left: 0, top: 0 });
  expect(frame.transform).toEqual([{ scale: 1 }]);
  expect(tileTransforms.length).toBeGreaterThan(0);
  for (const t of tileTransforms) expect(t).toEqual([{ scale: 1 }]);
  expect(mockRaster).toHaveBeenCalledWith(...rasterSize(1));
  expect(mockRaster).not.toHaveBeenCalledWith(...rasterSize(RES));
}

describe("GameCanvas render variants (#3684)", () => {
  it("#3684 regression: production never draws a canvas larger than the board, nor a View downscale", async () => {
    setRenderVariant("a");
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    await mount();
    const { canvas, frame } = drawn();
    expect(RES).toBeGreaterThan(1);
    expect(canvas.width).toBeLessThanOrEqual(200);
    expect(canvas.height).toBeLessThanOrEqual(160);
    expect(frame.width).toBeLessThanOrEqual(200);
    expect(frame.height).toBeLessThanOrEqual(160);
    expect(frame.transform).toEqual([{ scale: 1 }]);
    // #3684 review: the faces are rasterised at PixelRatio, not PixelRatio x res.
    expect(mockRaster).toHaveBeenCalledWith(...rasterSize(1));
    expect(mockRaster).not.toHaveBeenCalledWith(...rasterSize(RES));
  });

  it("outside a test build it draws the fixed renderer, whatever was picked, and records nothing", async () => {
    setRenderVariant("a");
    delete process.env.EXPO_PUBLIC_TEST_HOOKS;
    await mount();
    expectFixed();
    expect(diagSnapshot().canvas).toBeNull();
  });

  it("b (the default in a test build) is the fixed renderer, and is recorded", async () => {
    await mount();
    expectFixed();
    expect(diagSnapshot().canvas).toMatchObject({ variant: "b", res: RES, facesReady: 42 });
    expect(diagSnapshot().lastRaster).toMatchObject({ ready: 42, nulls: 0 });
  });

  it("a is the old oversized renderer, kept in test builds for the before/after demo", async () => {
    setRenderVariant("a");
    await mount();
    expectVariantA();
    expect(diagSnapshot().canvas).toMatchObject({ variant: "a", res: RES });
  });

  it("c draws a board-size canvas but keeps the faces at the board's resolution (test builds only)", async () => {
    setRenderVariant("c");
    await mount();
    const { canvas, frame, tileTransforms } = drawn();
    expect(canvas).toEqual({ width: 200, height: 160 });
    expect(frame).toMatchObject({ width: 200, height: 160, left: 0, top: 0 });
    expect(frame.transform).toEqual([{ scale: 1 }]);
    for (const t of tileTransforms) expect(t).toEqual([{ scale: 1 }]);
    expect(mockRaster).toHaveBeenCalledWith(...rasterSize(RES));
    expect(mockRaster).not.toHaveBeenCalledWith(...rasterSize(1));
  });

  it("counts only the passes that rasterised: a cache hit is not a raster", async () => {
    await mount();
    expect(diagSnapshot().rasters).toBe(1);
    // A second canvas at the same size finds the faces cached: its pass draws nothing.
    await mount();
    expect(diagSnapshot().rasters).toBe(1);
    // Another size does rasterise.
    setRenderVariant("c");
    await mount();
    expect(diagSnapshot().rasters).toBe(2);
  });

  it("re-renders a mounted canvas when the variant changes", async () => {
    await mount();
    expectFixed();
    await act(async () => {
      setRenderVariant("a");
    });
    expect(diagSnapshot().canvas).toMatchObject({ variant: "a" });
  });
});
