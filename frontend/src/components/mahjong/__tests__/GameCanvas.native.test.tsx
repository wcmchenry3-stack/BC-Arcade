/**
 * #2956: the native Mahjong board (GameCanvas.tsx, the iOS/Android Skia renderer). The existing
 * GameCanvas.test.tsx covers the web variant; this suite covers the file that ships on devices.
 *
 * Skia is stubbed with host Views that keep their props (testID `sk-<name>`), so a test reads
 * what would be drawn: the background fill, each tile's rects and their colours, and whether its
 * face art is the SVG or the suit-colour fallback. Tile groups render in the canvas's paint
 * order (layer, then row). Hit-testing is driven through the tap layer with locations in board
 * space, under the camera's tileToScreen projection.
 */
import React from "react";
import { fireEvent, render, screen, within } from "@testing-library/react-native";
import type { TestInstance } from "test-renderer";
import { useSVG } from "@shopify/react-native-skia";

import GameCanvas from "../GameCanvas";
import { TILE_REQUIRES } from "../tileAssets";
import {
  MAHJONG_GLOW_BG,
  MAHJONG_HINT_COLOR,
  MAHJONG_HINT_GLOW_BG,
  MAHJONG_TILE_FACE_SELECTED,
} from "../../../theme/theme.constants";
import { createGame } from "../../../game/mahjong/engine";
import { TURTLE_LAYOUT } from "../../../game/mahjong/layouts/turtle";
import { calculateMahjongLayout, makeBoardCamera } from "../../../game/mahjong/layout";
import type { BoardCamera } from "../../../game/mahjong/layout";
import type { MahjongState, SlotTile } from "../../../game/mahjong/types";

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
    ImageSVG: host("image-svg"),
    useSVG: jest.fn(() => null),
  };
});

const mockUseSVG = useSVG as unknown as jest.Mock;

// Colours the renderer keeps private (GameCanvas.tsx), pinned here on purpose.
const BG = "#1a3a1a";
const TILE_FACE = "#f5f0e8";
const TILE_FACE_LOCKED = "#d0c8b8";
const BORDER_NORMAL = "#8b7355";
const BORDER_SELECTED = "#ffd700";
const SHADOW = "rgba(0,0,0,0.35)";
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

async function mount(props: Partial<React.ComponentProps<typeof GameCanvas>> = {}) {
  const onTilePress = jest.fn();
  await render(
    <GameCanvas state={makeState()} camera={camera} onTilePress={onTilePress} {...props} />
  );
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
/** The tile's border and face rects (always the last two before its face art). */
function borderAndFace(tileId: number) {
  const rects = within(group(tileId)).getAllByTestId("sk-rect");
  const art = within(group(tileId)).queryByTestId("sk-image-svg");
  // With no SVG loaded the art is itself a rect, after the face.
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
  mockUseSVG.mockReset();
  mockUseSVG.mockReturnValue(null);
});

describe("Mahjong GameCanvas (native) — canvas", () => {
  it("fills the board with the felt-green background and labels the canvas", async () => {
    await mount();
    expect(screen.getByTestId("sk-fill").props.color).toBe(BG);
    const canvas = screen.getByTestId("sk-canvas");
    expect(canvas.props.accessibilityLabel).toBeTruthy();
    expect(canvas.props.style).toEqual({ width: 200, height: 160 });
  });

  it("preloads all 42 tile SVGs, one fixed hook per face", async () => {
    await mount();
    const sources = mockUseSVG.mock.calls.slice(0, 42).map((c) => c[0]);
    expect(sources).toEqual([...TILE_REQUIRES]);
  });

  it("draws every tile at its camera position, shadow first", async () => {
    await mount();
    for (const t of TILES) {
      const { x, y } = camera.tileToScreen(t.col, t.row, t.layer);
      const [shadow] = within(group(t.id)).getAllByTestId("sk-rect");
      expect(shadow!.props).toMatchObject({ color: SHADOW, x: x + 4 + 2, y: y + 4 + 2 });
    }
  });
});

describe("Mahjong GameCanvas (native) — tile styling", () => {
  it("free tiles get the light face, blocked and covered tiles the locked face", async () => {
    await mount();
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
    expect(screen.queryAllByTestId("sk-image-svg")).toHaveLength(0);
    const art = (id: number) => within(group(id)).getAllByTestId("sk-rect").at(-1)!;
    expect(art(3).props).toMatchObject({ color: "#880011", opacity: 1 }); // dragons, free
    expect(art(1).props).toMatchObject({ color: "#003322", opacity: 0.35 }); // bamboos, locked
    expect(art(0).props.color).toBe("#006633"); // circles
  });

  it("draws the loaded SVG for a face, dimmed on locked tiles", async () => {
    const circleOne = { svg: "circles-1" };
    mockUseSVG.mockImplementation((src: number) => (src === TILE_REQUIRES[16] ? circleOne : null));
    await mount();
    // Tiles 0, 2 and 4 are circle-1 (faceId 17).
    const svgOf = (id: number) => within(group(id)).getByTestId("sk-image-svg");
    expect(svgOf(0).props).toMatchObject({ svg: circleOne, opacity: 1, width: FACE_W - 4 });
    expect(svgOf(2).props.opacity).toBe(0.35);
    expect(within(group(3)).queryByTestId("sk-image-svg")).toBeNull();
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
