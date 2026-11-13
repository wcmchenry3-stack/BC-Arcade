/**
 * #2956: the native Mahjong board (GameCanvas.tsx, the iOS/Android Skia renderer). The existing
 * GameCanvas.test.tsx covers the web variant; this suite covers the file that ships on devices.
 *
 * Skia is stubbed with host Views that keep their props (testID `sk-<name>`), so a test reads
 * what would be drawn: the background fill, each tile's rects and their colours, and whether its
 * face art is the face's bitmap or the suit-colour fallback. Tile groups render in the canvas's
 * paint order (layer, then row). Hit-testing is driven through the tap layer with locations in
 * board space, under the camera's tileToScreen projection.
 *
 * Since #2962 the faces are decoded once (`loadData` + `Skia.SVG.MakeFromData`) and rasterised
 * once per face size into bitmaps (`Skia.Surface.Make`, drawn with `<Image>`) after the commit,
 * so a test lets that timer run (`afterCommit`) before reading faces; the stub surface returns
 * an image naming the SVG drawn into it. Each stub host counts its renders (`mockRenders`), so
 * a test can count how many tile groups a tap re-renders.
 */
import React from "react";
import { act, fireEvent, render, screen, within } from "@testing-library/react-native";
import { PixelRatio, StyleSheet } from "react-native";
import type { TestInstance } from "test-renderer";
import { loadData, Skia } from "@shopify/react-native-skia";

import GameCanvas from "../GameCanvas";
import { LIFT_SCALE } from "../../../game/mahjong/motion";
import type { TileMotion } from "../../../game/mahjong/motion";
import type { BoardMotion } from "../../../game/mahjong/useBoardMotion";
import { TILE_REQUIRES } from "../tileAssets";
import { resetTileFaces } from "../tileFaces";
import {
  MAHJONG_BOARD_BG,
  MAHJONG_DEADLOCK_DIM,
  MAHJONG_GLOW_BG,
  MAHJONG_HINT_COLOR,
  MAHJONG_HINT_GLOW_BG,
  MAHJONG_SPARK,
  MAHJONG_TILE_FACE_SELECTED,
} from "../../../theme/theme.mahjong";
import {
  createGame,
  freeTileIds,
  getAnyFreePair,
  getMatchingFreeTileIds,
  selectTile,
} from "../../../game/mahjong/engine";
import { TURTLE_LAYOUT } from "../../../game/mahjong/layouts/turtle";
import { calculateMahjongLayout, makeBoardCamera } from "../../../game/mahjong/layout";
import type { BoardCamera } from "../../../game/mahjong/layout";
import { boardResolution } from "../../../game/mahjong/zoom";
import type { MahjongState, SlotTile } from "../../../game/mahjong/types";

jest.mock("@shopify/react-native-skia", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createElement } = require("react");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require("react-native");
  const mockRenders: Record<string, number> = {};
  const host = (name: string) => {
    const Host = ({ children, ...props }: { children?: React.ReactNode }) => {
      mockRenders[name] = (mockRenders[name] ?? 0) + 1;
      return createElement(View, { testID: `sk-${name}`, ...props }, children);
    };
    Host.displayName = `Sk${name}`;
    return Host;
  };
  // A raster surface whose snapshot names the SVG drawn into it and its pixel size.
  const surface = (width: number, height: number) => {
    let drawn: unknown = null;
    const canvas = { scale: jest.fn(), drawSvg: (svg: unknown) => (drawn = svg) };
    return {
      getCanvas: () => canvas,
      flush: jest.fn(),
      makeImageSnapshot: () => ({ face: drawn, width, height, dispose: jest.fn() }),
      dispose: jest.fn(),
    };
  };
  return {
    mockRenders,
    Canvas: host("canvas"),
    Fill: host("fill"),
    Group: host("group"),
    Rect: host("rect"),
    Image: host("image"),
    BlurMask: host("blur"),
    Path: host("path"),
    // The data handed to MakeFromData is the asset source itself.
    loadData: jest.fn((source: unknown, factory: (d: unknown) => unknown) =>
      Promise.resolve(factory(source))
    ),
    Skia: {
      // #3613: the sparks are one path of circles.
      PathBuilder: {
        Make: () => {
          const circles: number[][] = [];
          const builder = {
            addCircle: (x: number, y: number, r: number) => {
              circles.push([x, y, r]);
              return builder;
            },
            detach: () => ({ circles }),
          };
          return builder;
        },
      },
      SVG: { MakeFromData: jest.fn(() => null) },
      Surface: { Make: jest.fn(surface) },
    },
  };
});

const mockLoadData = loadData as unknown as jest.Mock;
const mockMakeSvg = Skia.SVG.MakeFromData as unknown as jest.Mock;
const mockRaster = Skia.Surface.Make as unknown as jest.Mock;
const renders = (
  jest.requireMock("@shopify/react-native-skia") as { mockRenders: Record<string, number> }
).mockRenders;
function resetRenders() {
  for (const k of Object.keys(renders)) delete renders[k];
}

// Colours the renderer keeps private (GameCanvas.tsx), pinned here on purpose. The board
// background is the shared MAHJONG_BOARD_BG since #2962 (it was a private "#1a3a1a", which
// the web canvas had already replaced).
const BG = MAHJONG_BOARD_BG;
const TILE_FACE = "#f5f0e8";
// #3612: locked faces are a little darker (not washed out), under a light warm shade.
const TILE_FACE_LOCKED = "#f1eadd";
const LOCK_TINT = "rgba(40,30,15,0.08)";
const BORDER_NORMAL = "#8b7355";
const BORDER_SELECTED = "#ffd700";
const SHADOW = "rgba(0,0,0,0.38)";
const DEBUG_FREE = "#00cc44";

// A hand-made camera: 2 grid columns = 20 px, a row = 30 px, each layer up-left by 4 px.
const FACE_W = 18;
const FACE_H = 28;
const camera: BoardCamera = {
  tileToScreen: (col, row, layer) => ({
    x: 10 + col * 10 + layer * 4,
    y: 10 + row * 30 - layer * 4,
  }),
  tileWidth: 22,
  tileHeight: 32,
  faceWidth: FACE_W,
  faceHeight: FACE_H,
  sideWidth: 4,
  boardWidth: 200,
  boardHeight: 160,
  scale: 1,
  offsetX: 0,
  offsetY: 0,
  viewportWidth: 200,
  viewportHeight: 160,
};

function tile(
  id: number,
  suit: SlotTile["suit"],
  rank: SlotTile["rank"],
  faceId: number,
  col: number,
  row: number,
  layer = 0
): SlotTile {
  return { id, suit, rank, faceId, col, row, layer };
}

// 0 free (left end), 1 locked (both sides), 2 covered by 3, 3 on top, 4 alone in row 2.
const T0 = tile(0, "circles", 1, 17, 0, 0);
const T1 = tile(1, "bamboos", 2, 27, 2, 0);
const T2 = tile(2, "circles", 1, 17, 4, 0);
const T3 = tile(3, "dragons", 1, 1, 4, 0, 1);
const T4 = tile(4, "circles", 1, 17, 0, 2);
const TILES = [T0, T1, T2, T3, T4];
// Paint order: layer, then row (sort is stable).
const PAINT_ORDER = [0, 1, 2, 4, 3];

function makeState(overrides: Partial<MahjongState> = {}): MahjongState {
  return { ...createGame(TURTLE_LAYOUT, 1), tiles: TILES, selected: null, ...overrides };
}

/**
 * Run the face rasterisation the canvas schedules after a commit. Timers are fake in this
 * suite, so nothing is rasterised until a test asks: what a commit draws before it is visible.
 */
const afterCommit = () =>
  act(() => {
    jest.runOnlyPendingTimers();
  });

async function mount(props: Partial<React.ComponentProps<typeof GameCanvas>> = {}) {
  const onTilePress = jest.fn();
  await render(
    <GameCanvas state={makeState()} camera={camera} onTilePress={onTilePress} {...props} />
  );
  await afterCommit();
  return { onTilePress: (props.onTilePress as jest.Mock | undefined) ?? onTilePress };
}

/** The drawn group of one tile. */
function group(tileId: number) {
  const groups = screen.getAllByTestId("sk-group");
  expect(groups).toHaveLength(PAINT_ORDER.length);
  return groups[PAINT_ORDER.indexOf(tileId)]!;
}
function rectColors(tileId: number): string[] {
  return within(group(tileId))
    .queryAllByTestId("sk-rect")
    .map((r) => r.props.color as string);
}
/** A tile's rects, without the locked shade drawn over its face and art (#3612). */
function bodyRects(tileId: number) {
  return within(group(tileId))
    .getAllByTestId("sk-rect")
    .filter((r) => r.props.color !== LOCK_TINT);
}
/** The tile's border and face rects (always the last two before its face art). */
function borderAndFace(tileId: number) {
  const rects = bodyRects(tileId);
  const art = within(group(tileId)).queryByTestId("sk-image");
  // With no face loaded the art is itself a rect, after the face.
  const body = art ? rects : rects.slice(0, -1);
  return { border: body.at(-2)!, face: body.at(-1)! };
}

/** The `onPress` of the component that rendered this host element (a Pressable's), if any. */
function onPressOf(node: TestInstance): unknown {
  // Walk up through the composite owners, stopping at the next host element.
  for (let f = node.unstable_fiber?.return; f && typeof f.type !== "string"; f = f.return) {
    const onPress = (f.memoizedProps as { onPress?: unknown } | null)?.onPress;
    if (typeof onPress === "function") return onPress;
  }
  return undefined;
}

/**
 * The full-board tap layer: the role="none" element with an onPress (a Pressable over the
 * canvas). The Skia Canvas also carries role "none" but has no onPress. Exactly one when taps
 * are on, none when they are off; anything else fails here so drift is visible.
 */
function tapLayers(): TestInstance[] {
  return screen
    .root!.queryAll((n) => n.props.accessibilityRole === "none")
    .filter((n) => onPressOf(n) !== undefined);
}
function tapLayer(): TestInstance | undefined {
  const layers = tapLayers();
  expect(layers.length).toBeLessThanOrEqual(1);
  return layers[0];
}
async function tap(x: number, y: number) {
  const layers = tapLayers();
  expect(layers).toHaveLength(1);
  await fireEvent.press(layers[0]!, { nativeEvent: { locationX: x, locationY: y } });
}

beforeEach(() => {
  // Each test starts as the app does: nothing decoded or rasterised yet.
  resetTileFaces();
  jest.clearAllMocks();
  resetRenders();
  mockMakeSvg.mockReturnValue(null);
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("Mahjong GameCanvas (native) — canvas", () => {
  it("fills the board with the shared board background and labels the canvas", async () => {
    await mount();
    expect(screen.getByTestId("sk-fill").props.color).toBe(BG);
    const canvas = screen.getByTestId("sk-canvas");
    expect(canvas.props.accessibilityLabel).toBeTruthy();
    // #3684: the canvas is the 200 x 160 board's own size (the oversized #3611 canvas, shrunk
    // by a View transform, is gone: iOS stopped presenting and aliased it), with no View
    // downscale, and every tile is drawn at scale 1.
    expect(boardResolution(camera.scale, camera.tileWidth)).toBeCloseTo(48 / 22, 5);
    expect(canvas.props.style).toEqual({ width: 200, height: 160 });
    const frame = StyleSheet.flatten(canvas.parent!.props.style);
    expect(frame).toEqual({
      position: "absolute",
      width: 200,
      height: 160,
      left: 0,
      top: 0,
      transform: [{ scale: 1 }],
    });
    for (const id of PAINT_ORDER) expect(group(id).props.transform).toEqual([{ scale: 1 }]);
  });

  it("rasterises the faces at the device pixel ratio, not times the board's resolution (#3684 review)", async () => {
    mockMakeSvg.mockImplementation((src: number) => ({ svg: src }));
    await mount();
    // #3684 review: hi-res faces gave no visible gain for about 3x the face memory.
    expect(boardResolution(camera.scale, camera.tileWidth)).toBeGreaterThan(1);
    const px = PixelRatio.get();
    expect(mockRaster).toHaveBeenCalledWith(
      Math.ceil((FACE_W - 4) * px),
      Math.ceil((FACE_H - 4) * px)
    );
  });

  it("loads all 42 tile SVGs, one per face in face order", async () => {
    await mount();
    const sources = mockLoadData.mock.calls.map((c) => c[0]);
    expect(sources).toEqual([...TILE_REQUIRES]);
    expect(mockMakeSvg.mock.calls.map((c) => c[0])).toEqual([...TILE_REQUIRES]);
  });

  it("draws every tile at its camera position, shadow first", async () => {
    await mount();
    for (const t of TILES) {
      const { x, y } = camera.tileToScreen(t.col, t.row, t.layer);
      const [shadow] = within(group(t.id)).getAllByTestId("sk-rect");
      // #3612: cast down-right by 1.3 sides (side 4 here), softened by a blur.
      expect(shadow!.props).toMatchObject({ color: SHADOW, x: x + 5, y: y + 5 });
      expect(within(shadow!).getByTestId("sk-blur").props.style).toBe("normal");
    }
  });
});

describe("Mahjong GameCanvas (native) — tile styling", () => {
  it("free tiles get the light face, blocked and covered tiles the locked face", async () => {
    await mount();
    // Locked tiles are shaded, free ones are not (#3612).
    const shaded = [0, 1, 2, 3, 4].filter((id) => rectColors(id).includes(LOCK_TINT));
    expect(shaded).toEqual([1, 2]);
    expect(borderAndFace(0).face.props.color).toBe(TILE_FACE);
    expect(borderAndFace(4).face.props.color).toBe(TILE_FACE);
    expect(borderAndFace(3).face.props.color).toBe(TILE_FACE);
    expect(borderAndFace(1).face.props.color).toBe(TILE_FACE_LOCKED); // both sides blocked
    expect(borderAndFace(2).face.props.color).toBe(TILE_FACE_LOCKED); // covered by tile 3
    for (const id of [0, 1, 2, 3, 4]) {
      expect(borderAndFace(id).border.props.color).toBe(BORDER_NORMAL);
    }
  });

  it("the selected tile is lifted, gold-bordered and glows; its free matches glow blue", async () => {
    await mount({ state: makeState({ selected: T0 }) });
    const { border, face } = borderAndFace(0);
    expect(border.props.color).toBe(BORDER_SELECTED);
    expect(face.props.color).toBe(MAHJONG_TILE_FACE_SELECTED);
    // Lifted up-right in proportion to the tile size, with a 2 px border.
    const liftX = Math.round(22 * (4 / 44));
    const liftY = -Math.round(32 * (5 / 56));
    expect(border.props).toMatchObject({ x: 10 + liftX, y: 10 + liftY });
    expect(face.props).toMatchObject({ x: 10 + 2 + liftX, width: FACE_W - 4 });
    expect(rectColors(0)).toContain(MAHJONG_GLOW_BG);

    // Tile 4 matches and is free; tile 2 matches but is covered, so it gets no hint.
    expect(rectColors(4)).toContain(MAHJONG_HINT_GLOW_BG);
    expect(borderAndFace(4).border.props.color).toBe(MAHJONG_HINT_COLOR);
    expect(rectColors(2)).not.toContain(MAHJONG_HINT_GLOW_BG);
    expect(rectColors(1)).not.toContain(MAHJONG_HINT_GLOW_BG);
  });

  it("hint ids from the screen glow like matches", async () => {
    await mount({ hintIds: new Set([3]) });
    expect(rectColors(3)).toContain(MAHJONG_HINT_GLOW_BG);
    expect(borderAndFace(3).border.props.color).toBe(MAHJONG_HINT_COLOR);
    expect(rectColors(0)).not.toContain(MAHJONG_HINT_GLOW_BG);
  });

  it("falls back to a suit-colour rect until a face SVG loads", async () => {
    await mount();
    expect(screen.queryAllByTestId("sk-image")).toHaveLength(0);
    const art = (id: number) => bodyRects(id).at(-1)!;
    expect(art(3).props).toMatchObject({ color: "#880011", opacity: 1 }); // dragons, free
    expect(art(1).props).toMatchObject({ color: "#003322", opacity: 0.35 }); // bamboos, locked
    expect(art(0).props.color).toBe("#006633"); // circles
  });

  it("draws the loaded SVG for a face, undimmed on locked tiles as native always has", async () => {
    const circleOne = { svg: "circles-1" };
    mockMakeSvg.mockImplementation((src: number) => (src === TILE_REQUIRES[16] ? circleOne : null));
    await mount();
    // Tiles 0, 2 and 4 are circle-1 (faceId 17), drawn from the bitmap of that one SVG.
    const svgOf = (id: number) => within(group(id)).getByTestId("sk-image");
    expect(svgOf(0).props).toMatchObject({ opacity: 1, width: FACE_W - 4, height: FACE_H - 4 });
    expect(svgOf(0).props.image).toMatchObject({ face: circleOne });
    // Tile 2 is locked. The <ImageSVG> this replaced ignored its 0.35 opacity (Skia draws an
    // SVG without the paint), so the bitmap keeps full opacity to look exactly as before (#2962).
    expect(svgOf(2).props.opacity).toBe(1);
    expect(svgOf(2).props.image).toBe(svgOf(0).props.image);
    expect(within(group(3)).queryByTestId("sk-image")).toBeNull();
  });

  it("the debug overlay tints exactly the free tiles", async () => {
    await mount({ debugShowFree: true });
    const tinted = [0, 1, 2, 3, 4].filter((id) => rectColors(id).includes(DEBUG_FREE));
    expect(tinted).toEqual([0, 3, 4]);
  });
});

describe("Mahjong GameCanvas (native) — hit-testing and onTilePress", () => {
  it("a tap inside a tile's face presses that tile", async () => {
    const { onTilePress } = await mount();
    await tap(15, 15); // tile 0 at (10,10)
    expect(onTilePress).toHaveBeenCalledWith(0);
    await tap(10 + 0 * 10 + 5, 10 + 2 * 30 + 5); // tile 4
    expect(onTilePress).toHaveBeenLastCalledWith(4);
  });

  it("where tiles overlap, the topmost layer wins", async () => {
    const { onTilePress } = await mount();
    // (60, 12) is inside tile 2 (50..68, 10..38) and tile 3 (54..72, 6..34).
    await tap(60, 12);
    expect(onTilePress).toHaveBeenCalledTimes(1);
    expect(onTilePress).toHaveBeenCalledWith(3);
    // (51, 36) is only inside tile 2.
    await tap(51, 36);
    expect(onTilePress).toHaveBeenLastCalledWith(2);
  });

  it("face edges are half-open: the right and bottom edge belong to the next tile", async () => {
    const { onTilePress } = await mount();
    await tap(10 + FACE_W, 15); // just past tile 0's face, in the gap before tile 1
    expect(onTilePress).not.toHaveBeenCalled();
    await tap(30, 15); // tile 1's left edge
    expect(onTilePress).toHaveBeenCalledWith(1);
  });

  it("a tap on empty felt presses nothing", async () => {
    const { onTilePress } = await mount();
    await tap(190, 150);
    expect(onTilePress).not.toHaveBeenCalled();
  });

  it("hit-tests in board space under a real board camera", async () => {
    const real = makeBoardCamera(
      calculateMahjongLayout({
        screenWidth: 768,
        screenHeight: 1024,
        safeAreaTop: 0,
        safeAreaBottom: 0,
        boardRows: 8,
        boardCols: 12,
        boardLayers: 4,
      })
    );
    const state = createGame(TURTLE_LAYOUT, 12345);
    const onTilePress = jest.fn();
    await render(<GameCanvas state={state} camera={real} onTilePress={onTilePress} />);
    // The single top tile of the turtle (highest layer) is pressed over everything beneath it.
    const top = [...state.tiles].sort((a, b) => b.layer - a.layer)[0]!;
    const { x, y } = real.tileToScreen(top.col, top.row, top.layer);
    await tap(x + real.faceWidth / 2, y + real.faceHeight / 2);
    expect(onTilePress).toHaveBeenCalledWith(top.id);
  });

  it("no tap layer while the game is complete, deadlocked, or waiting on a shuffle", async () => {
    await mount({ state: makeState({ isComplete: true }) });
    expect(tapLayer()).toBeUndefined();
    await mount({ state: makeState({ isDeadlocked: true }) });
    expect(tapLayer()).toBeUndefined();
    // No free pair left (tiles 1 and 3 are both free but do not match), shuffles available.
    await mount({ state: makeState({ tiles: [T1, T3], shufflesLeft: 2 }) });
    expect(tapLayer()).toBeUndefined();
  });

  it("with no free pair and no shuffles left, taps still reach the board", async () => {
    const onTilePress = jest.fn();
    await mount({ state: makeState({ tiles: [T1, T3], shufflesLeft: 0 }), onTilePress });
    await tap(60, 10);
    expect(onTilePress).toHaveBeenCalledWith(3);
  });
});

describe("Mahjong GameCanvas (native) — work per tap and per mount (#2962)", () => {
  const realCamera = (screenWidth = 768) =>
    makeBoardCamera(
      calculateMahjongLayout({
        screenWidth,
        screenHeight: 1024,
        safeAreaTop: 0,
        safeAreaBottom: 0,
        boardRows: 8,
        boardCols: 12,
        boardLayers: 4,
      })
    );

  /** Each tile's look (selected, free, glowing), keyed by id. */
  function looks(s: MahjongState, hintIds: ReadonlySet<number> = new Set()) {
    const free = freeTileIds(s.tiles);
    const matching = getMatchingFreeTileIds(s, free);
    return new Map(
      s.tiles.map((t) => [
        t.id,
        [t.id === s.selected?.id, free.has(t.id), matching.has(t.id) || hintIds.has(t.id)].join(),
      ])
    );
  }
  /** How many tiles of `b` look different from (or are new since) `a`. */
  function changed(a: Map<number, string>, b: Map<number, string>): number {
    return [...b].filter(([id, look]) => a.get(id) !== look).length;
  }

  it("a tap re-renders only the tiles whose look changed", async () => {
    mockMakeSvg.mockImplementation((src: number) => ({ svg: src }));
    const camera = realCamera();
    const onTilePress = jest.fn();
    const s0 = createGame(TURTLE_LAYOUT, 12345);
    const view = await render(<GameCanvas state={s0} camera={camera} onTilePress={onTilePress} />);
    // The first mount of the session draws every tile twice: suit fallbacks, then the faces
    // once all 42 have loaded and been rasterised after the commit (one update, where 42
    // useSVG hooks could update one by one).
    expect(renders.group).toBe(144);
    expect(screen.queryAllByTestId("sk-image")).toHaveLength(0);
    await afterCommit();
    expect(renders.group).toBe(2 * 144);

    // Selecting a tile: it and its free matches.
    const [a, b] = getAnyFreePair(s0.tiles)!;
    const s1 = selectTile(s0, a);
    resetRenders();
    await view.rerender(<GameCanvas state={s1} camera={camera} onTilePress={onTilePress} />);
    expect(renders.group).toBe(changed(looks(s0), looks(s1)));
    expect(renders.group).toBeLessThanOrEqual(3);
    expect(renders.group).toBeGreaterThan(0);

    // Matching it: the pair is gone; the tiles it freed and the dropped glow re-render.
    const s2 = selectTile(s1, b);
    expect(s2.tiles).toHaveLength(142);
    resetRenders();
    await view.rerender(<GameCanvas state={s2} camera={camera} onTilePress={onTilePress} />);
    expect(renders.group).toBe(changed(looks(s1), looks(s2)));
    expect(renders.group).toBeLessThanOrEqual(3);
    expect(screen.getAllByTestId("sk-group")).toHaveLength(142);

    // A hint glows only its two tiles; a parent re-render with nothing new redraws no tile.
    const hint = new Set(getAnyFreePair(s2.tiles)!);
    resetRenders();
    await view.rerender(
      <GameCanvas state={s2} camera={camera} hintIds={hint} onTilePress={onTilePress} />
    );
    expect(renders.group).toBe(changed(looks(s2), looks(s2, hint)));
    resetRenders();
    await view.rerender(
      <GameCanvas state={s2} camera={camera} hintIds={hint} onTilePress={jest.fn()} />
    );
    expect(renders.group ?? 0).toBe(0);
    expect(renders.canvas).toBe(1);
  });

  it("uses the screen's free set when it is given one", async () => {
    // Told only tile 1 is free (by the board 0, 3 and 4 are), the canvas styles it that way.
    await mount({ freeIds: new Set([1]) });
    expect(borderAndFace(1).face.props.color).toBe(TILE_FACE);
    expect(borderAndFace(0).face.props.color).toBe(TILE_FACE_LOCKED);
  });

  it("decodes and rasterises the 42 faces once, then reuses them on every mount", async () => {
    mockMakeSvg.mockImplementation((src: number) => ({ svg: src }));
    const camera = realCamera();
    const state = createGame(TURTLE_LAYOUT, 7);
    const first = await render(
      <GameCanvas state={state} camera={camera} onTilePress={jest.fn()} />
    );
    // Loaded, but not rasterised during a render: the first commit has placeholders.
    expect(mockLoadData).toHaveBeenCalledTimes(42);
    expect(mockRaster).not.toHaveBeenCalled();
    expect(screen.queryAllByTestId("sk-image")).toHaveLength(0);
    await afterCommit();
    expect(mockRaster).toHaveBeenCalledTimes(42);
    expect(screen.getAllByTestId("sk-image")).toHaveLength(144);
    await first.unmount();

    // The canvas unmounts whenever the screen leaves play; coming back costs no decode, no
    // rasterisation, and draws the faces on the first render (no fallback pass).
    resetRenders();
    const second = await render(
      <GameCanvas state={state} camera={camera} onTilePress={jest.fn()} />
    );
    expect(mockLoadData).toHaveBeenCalledTimes(42);
    expect(mockRaster).toHaveBeenCalledTimes(42);
    expect(renders.group).toBe(144);
    expect(renders.image).toBe(144);
    await afterCommit(); // and nothing follows: no second pass over the tiles
    expect(renders.group).toBe(144);
    const paintOrder = [...state.tiles].sort((x, y) => x.layer - y.layer || x.row - y.row);
    const image = (id: number) =>
      within(
        screen.getAllByTestId("sk-group")[paintOrder.findIndex((t) => t.id === id)]!
      ).getByTestId("sk-image").props.image;
    const t0 = state.tiles[0]!;
    expect(image(t0.id)).toMatchObject({ face: { svg: TILE_REQUIRES[t0.faceId - 1] } });

    // A new face size is rasterised once, after the commit (the old faces, scaled, stand in
    // until then); the old size is still cached.
    const narrow = realCamera(600);
    expect(narrow.faceWidth).not.toBe(camera.faceWidth);
    const wideFace = image(t0.id);
    await second.rerender(<GameCanvas state={state} camera={narrow} onTilePress={jest.fn()} />);
    expect(mockRaster).toHaveBeenCalledTimes(42);
    expect(image(t0.id)).toBe(wideFace);
    await afterCommit();
    expect(mockRaster).toHaveBeenCalledTimes(84);
    const narrowFace = image(t0.id);
    expect(narrowFace).not.toBe(wideFace);
    await second.rerender(<GameCanvas state={state} camera={camera} onTilePress={jest.fn()} />);
    expect(image(t0.id)).toBe(wideFace); // cached: on the first render
    expect(mockRaster).toHaveBeenCalledTimes(84);
    await second.rerender(<GameCanvas state={state} camera={narrow} onTilePress={jest.fn()} />);
    expect(image(t0.id)).toBe(narrowFace);
    expect(mockLoadData).toHaveBeenCalledTimes(42);
  });

  it("sorts the paint and hit-test orders once per board, never per tap", async () => {
    const isTileList = (ctx: unknown) =>
      Array.isArray(ctx) && ctx.length > 0 && typeof (ctx[0] as SlotTile).layer === "number";
    const sort = jest.spyOn(Array.prototype, "sort");
    const tileSorts = () => sort.mock.contexts.filter(isTileList).length;
    const onTilePress = jest.fn();
    const view = await render(
      <GameCanvas state={makeState()} camera={camera} onTilePress={onTilePress} />
    );
    expect(tileSorts()).toBe(2);

    // Taps and a selection change on the same board sort nothing.
    await tap(60, 12);
    await tap(15, 15);
    await view.rerender(
      <GameCanvas state={makeState({ selected: T0 })} camera={camera} onTilePress={onTilePress} />
    );
    await tap(51, 36);
    expect(onTilePress.mock.calls).toEqual([[3], [0], [2]]);
    expect(tileSorts()).toBe(2);

    // A new board is sorted once more, both orders.
    await view.rerender(
      <GameCanvas
        state={makeState({ tiles: [T0, T2, T3, T4] })}
        camera={camera}
        onTilePress={onTilePress}
      />
    );
    expect(tileSorts()).toBe(4);
    await tap(60, 12);
    expect(onTilePress).toHaveBeenLastCalledWith(3);
    expect(tileSorts()).toBe(4);
  });
});

describe("Mahjong GameCanvas (native) — motion (#3613)", () => {
  const clock = (value: number) => ({ progress: { value }, t0: 0, duration: 100 });
  // #3684: tiles are drawn at scale 1 (the canvas is the board's size).
  const res = () => 1;
  const motionWith = (tiles: Map<number, TileMotion>, extra: Partial<BoardMotion> = {}) => ({
    tiles,
    ghosts: [],
    cascade: null,
    ...extra,
  });
  /** A tile's look transform: board scale, then moved and scaled about its face's centre. */
  function lookTransform(id: number, dx: number, dy: number, s: number) {
    const t = TILES.find((x) => x.id === id)!;
    const { x, y } = camera.tileToScreen(t.col, t.row, t.layer);
    const cx = x + FACE_W / 2;
    const cy = y + FACE_H / 2;
    return [
      { scale: res() },
      { translateX: cx + dx },
      { translateY: cy + dy },
      { scale: s },
      { translateX: -cx },
      { translateY: -cy },
    ];
  }

  it("only a tile in an animation becomes animated; the rest keep their fixed transform", async () => {
    const tiles = new Map<number, TileMotion>([[4, { lift: { ...clock(0), from: 0, to: 1 } }]]);
    await mount({ state: makeState({ selected: T4 }), motion: motionWith(tiles) });
    // At the lift's start the tile is still flat: no offset, no scale, no glow yet.
    expect(group(4).props.transform).toEqual({ value: lookTransform(4, 0, 0, 1) });
    const glow = within(group(4))
      .getAllByTestId("sk-rect")
      .find((r) => r.props.color === MAHJONG_GLOW_BG)!;
    expect(glow.props.opacity.value).toBeCloseTo(0, 9);
    for (const id of [0, 1, 2, 3]) expect(group(id).props.transform).toEqual([{ scale: res() }]);
  });

  it("a dealt tile moves by its transform alone: no glow, its shadow fixed in its group", async () => {
    const tiles = new Map<number, TileMotion>([[3, { deal: { ...clock(0.2), delay: 0.3 } }]]);
    await mount({ motion: motionWith(tiles) });
    expect(group(3).props.transform).toHaveProperty("value");
    expect(rectColors(3)).not.toContain(MAHJONG_GLOW_BG);
    const [shadow] = within(group(3)).getAllByTestId("sk-rect");
    expect(typeof shadow!.props.x).toBe("number");
  });

  it("a finished lift is the selected tile's resting look", async () => {
    const tiles = new Map<number, TileMotion>([[0, { lift: { ...clock(1), from: 0, to: 1 } }]]);
    await mount({ state: makeState({ selected: T0 }), motion: motionWith(tiles) });
    const liftX = Math.round(22 * (4 / 44));
    const liftY = -Math.round(32 * (5 / 56));
    const moving = group(0).props.transform.value as Record<string, number>[];
    const expected = lookTransform(0, liftX, liftY, LIFT_SCALE);
    moving.forEach((step, i) => {
      const [k, v] = Object.entries(expected[i]!)[0]!;
      expect(step[k]).toBeCloseTo(v as number, 5);
    });
  });

  it("the deadlock dims a locked tile through its own rect", async () => {
    const tiles = new Map<number, TileMotion>([[1, { dim: clock(0.5) }]]);
    await mount({ motion: motionWith(tiles) });
    const dim = within(group(1))
      .getAllByTestId("sk-rect")
      .find((r) => r.props.color === MAHJONG_DEADLOCK_DIM)!;
    expect(dim.props.opacity.value).toBeCloseTo(1, 5);
    expect(rectColors(0)).not.toContain(MAHJONG_DEADLOCK_DIM);
  });

  it("a matched pair is drawn over the board with its art, then its sparks; the cascade over all", async () => {
    const ghost = { key: "g", tiles: [T0, T4] as const, clock: clock(0.8) };
    const cascade = { clock: clock(0.5), x: 100, y: 80 };
    await mount({
      state: makeState({ tiles: [T1, T2, T3] }),
      motion: motionWith(new Map(), { ghosts: [ghost], cascade }),
    });
    const groups = screen.getAllByTestId("sk-group");
    // Three board tiles, two ghost tiles, then the burst's and the cascade's spark groups.
    expect(groups).toHaveLength(3 + 2 + 2);
    const paths = screen.getAllByTestId("sk-path");
    expect(paths).toHaveLength(2);
    for (const p of paths) {
      expect(p.props.color).toBe(MAHJONG_SPARK);
      expect(p.props.path.value.circles.length).toBeGreaterThan(0);
    }
    // The ghosts fade as they burst.
    expect(groups[3]!.props.opacity.value).toBeLessThan(1);
  });
});
