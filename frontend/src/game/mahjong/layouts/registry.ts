import type { LayoutMeta, Layout } from "../types";
import { parseLayout } from "./loader";
import turtleData from "../../../../assets/mahjong/layouts/turtle.json";
import pyramidData from "../../../../assets/mahjong/layouts/pyramid.json";
import squareData from "../../../../assets/mahjong/layouts/square.json";
import arenaData from "../../../../assets/mahjong/layouts/arena.json";
import fourRiversData from "../../../../assets/mahjong/layouts/four_rivers.json";
import butterflyData from "../../../../assets/mahjong/layouts/butterfly.json";
import fishData from "../../../../assets/mahjong/layouts/fish.json";
import spiderData from "../../../../assets/mahjong/layouts/spider.json";
import catData from "../../../../assets/mahjong/layouts/cat.json";
import snowflakeData from "../../../../assets/mahjong/layouts/snowflake.json";
import castleData from "../../../../assets/mahjong/layouts/castle.json";
import bridgeData from "../../../../assets/mahjong/layouts/bridge.json";
import gateData from "../../../../assets/mahjong/layouts/gate.json";
import doublePyramidData from "../../../../assets/mahjong/layouts/double_pyramid.json";
import anchorData from "../../../../assets/mahjong/layouts/anchor.json";
import crownData from "../../../../assets/mahjong/layouts/crown.json";
import shieldData from "../../../../assets/mahjong/layouts/shield.json";
import heartData from "../../../../assets/mahjong/layouts/heart.json";
import hourglassData from "../../../../assets/mahjong/layouts/hourglass.json";
import theKeyData from "../../../../assets/mahjong/layouts/the_key.json";
import diamondData from "../../../../assets/mahjong/layouts/diamond.json";
import xWingData from "../../../../assets/mahjong/layouts/x_wing.json";
import mazeData from "../../../../assets/mahjong/layouts/maze.json";
import zigZagData from "../../../../assets/mahjong/layouts/zig_zag.json";
import concentricSquaresData from "../../../../assets/mahjong/layouts/concentric_squares.json";

export const LAYOUTS: LayoutMeta[] = [
  {
    id: "turtle",
    name: "Turtle",
    tier: 1,
    tileCount: 144,
    data: turtleData,
  },
  {
    id: "pyramid",
    name: "Pyramid",
    tier: 1,
    tileCount: 144,
    data: pyramidData,
  },
  {
    id: "square",
    name: "Square",
    tier: 1,
    tileCount: 144,
    data: squareData,
  },
  {
    id: "arena",
    name: "Arena",
    tier: 1,
    tileCount: 144,
    data: arenaData,
  },
  {
    id: "four_rivers",
    name: "Four Rivers",
    tier: 1,
    tileCount: 144,
    data: fourRiversData,
  },
  {
    id: "butterfly",
    name: "Butterfly",
    tier: 2,
    tileCount: 144,
    data: butterflyData,
  },
  {
    id: "fish",
    name: "Fish",
    tier: 2,
    tileCount: 144,
    data: fishData,
  },
  {
    id: "spider",
    name: "Spider",
    tier: 2,
    tileCount: 144,
    data: spiderData,
  },
  {
    id: "cat",
    name: "Cat",
    tier: 2,
    tileCount: 144,
    data: catData,
  },
  {
    id: "snowflake",
    name: "Snowflake",
    tier: 2,
    tileCount: 144,
    data: snowflakeData,
  },
  {
    id: "castle",
    name: "Castle",
    tier: 2,
    tileCount: 144,
    data: castleData,
  },
  {
    id: "bridge",
    name: "Bridge",
    tier: 2,
    tileCount: 144,
    data: bridgeData,
  },
  {
    id: "gate",
    name: "Gate",
    tier: 2,
    tileCount: 144,
    data: gateData,
  },
  {
    id: "double_pyramid",
    name: "Double Pyramid",
    tier: 2,
    tileCount: 144,
    data: doublePyramidData,
  },
  {
    id: "anchor",
    name: "Anchor",
    tier: 2,
    tileCount: 144,
    data: anchorData,
  },
  {
    id: "crown",
    name: "Crown",
    tier: 2,
    tileCount: 144,
    data: crownData,
  },
  {
    id: "shield",
    name: "Shield",
    tier: 2,
    tileCount: 144,
    data: shieldData,
  },
  {
    id: "heart",
    name: "Heart",
    tier: 2,
    tileCount: 144,
    data: heartData,
  },
  {
    id: "hourglass",
    name: "Hourglass",
    tier: 2,
    tileCount: 144,
    data: hourglassData,
  },
  {
    id: "the_key",
    name: "The Key",
    tier: 2,
    tileCount: 144,
    data: theKeyData,
  },
  {
    id: "diamond",
    name: "Diamond",
    tier: 2,
    tileCount: 144,
    data: diamondData,
  },
  {
    id: "x_wing",
    name: "X-Wing",
    tier: 2,
    tileCount: 144,
    data: xWingData,
  },
  {
    id: "maze",
    name: "Maze",
    tier: 2,
    tileCount: 144,
    data: mazeData,
  },
  {
    id: "zig_zag",
    name: "Zig-Zag",
    tier: 2,
    tileCount: 144,
    data: zigZagData,
  },
  {
    id: "concentric_squares",
    name: "Concentric Squares",
    tier: 2,
    tileCount: 144,
    data: concentricSquaresData,
  },
];

// Parse every layout once at module init so getLayout() is O(1) at call time.
const _parsed: Map<string, Layout> = new Map(
  LAYOUTS.map((m) => [m.id, parseLayout(m.data, m.tileCount)])
);

/** Look up a pre-validated Layout by its registry ID. Throws for unknown IDs. */
export function getLayout(id: string): Layout {
  const layout = _parsed.get(id);
  if (!layout) throw new Error(`Layout not found: ${id}`);
  return layout;
}

/**
 * Return the layout ID from a state object, defaulting to "turtle" for old
 * saves that pre-date the currentLayoutId field.
 */
export function resolveLayoutId(state: { currentLayoutId?: string }): string {
  return state.currentLayoutId ?? "turtle";
}
