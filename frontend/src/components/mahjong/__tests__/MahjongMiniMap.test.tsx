/**
 * #3612: Mahjong's mini-map — the remaining tiles as rects at the map's scale, the view window
 * from the live camera, and a tap that centres the view on that board point.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { StyleSheet } from "react-native";
import MahjongMiniMap, { MINIMAP_W } from "../MahjongMiniMap";
import type { BoardCamera } from "../../../game/mahjong/layout";
import type { SlotTile } from "../../../game/mahjong/types";

// A 480 x 360 board (the map is 96 wide, so 1/5 scale) in a 240 x 180 viewport.
const camera = {
  tileToScreen: (col: number, row: number) => ({ x: 20 + col * 20, y: 20 + row * 50 }),
  tileWidth: 40,
  tileHeight: 50,
  faceWidth: 36,
  faceHeight: 46,
  sideWidth: 4,
  boardWidth: 480,
  boardHeight: 360,
  scale: 0.5,
  offsetX: 0,
  offsetY: 0,
  viewportWidth: 240,
  viewportHeight: 180,
} as unknown as BoardCamera;

const tile = (id: number, col: number, row: number): SlotTile =>
  ({ id, suit: "circles", rank: 1, faceId: 17, col, row, layer: 0 }) as SlotTile;

async function mount(zoom: number, tx: number, ty: number, onPanTo = jest.fn()) {
  const view = {
    zoomScale: { value: zoom },
    translateX: { value: tx },
    translateY: { value: ty },
  } as never;
  await render(
    <MahjongMiniMap
      tiles={[tile(0, 0, 0), tile(1, 10, 4)]}
      camera={camera}
      view={view}
      onPanTo={onPanTo}
    />
  );
  return onPanTo;
}

describe("MahjongMiniMap", () => {
  it("is MINIMAP_W wide, as tall as the board's aspect, and labelled", async () => {
    await mount(1, 0, 0);
    const map = screen.getByTestId("mahjong-minimap");
    expect(StyleSheet.flatten(map.props.style)).toMatchObject({ width: MINIMAP_W, height: 72 });
    expect(map.props.accessibilityLabel).toBe("Board overview. Tap to move the view there.");
  });

  it("frames the part of the board on screen", async () => {
    // At 1x, offset (-60, -30): the 240 x 180 view is centred on board point (300, 210).
    await mount(1, -60, -30);
    const w = StyleSheet.flatten(screen.getByTestId("mahjong-minimap-window").props.style);
    expect(w.left).toBeCloseTo((300 - 120) / 5, 5);
    expect(w.top).toBeCloseTo((210 - 90) / 5, 5);
    expect(w.width).toBeCloseTo(48, 5);
    expect(w.height).toBeCloseTo(36, 5);
  });

  it("centres the view on the board point under a tap", async () => {
    const onPanTo = await mount(1, 0, 0);
    await fireEvent.press(screen.getByTestId("mahjong-minimap"), {
      nativeEvent: { locationX: 10, locationY: 20 },
    });
    expect(onPanTo).toHaveBeenCalledWith(50, 100);
  });

  it("reads a web click's offsetX/Y when the event has no locationX/Y", async () => {
    const onPanTo = await mount(1, 0, 0);
    await fireEvent.press(screen.getByTestId("mahjong-minimap"), {
      nativeEvent: { locationX: undefined, locationY: undefined, offsetX: 80, offsetY: 20 },
    });
    expect(onPanTo).toHaveBeenCalledWith(400, 100);
  });
});
