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
