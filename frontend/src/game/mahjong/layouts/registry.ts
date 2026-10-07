import type { LayoutMeta, Layout } from "../types";
import { parseLayout } from "./loader";
import { TURTLE_LAYOUT } from "./turtle";
import { PYRAMID_LAYOUT } from "./pyramid";
import { SQUARE_LAYOUT } from "./square";
import { ARENA_LAYOUT } from "./arena";
import { FOUR_RIVERS_LAYOUT } from "./four_rivers";
import { BUTTERFLY_LAYOUT } from "./butterfly";
import { FISH_LAYOUT } from "./fish";
import { SPIDER_LAYOUT } from "./spider";
import { CAT_LAYOUT } from "./cat";
import { SNOWFLAKE_LAYOUT } from "./snowflake";
import { CASTLE_LAYOUT } from "./castle";
import { BRIDGE_LAYOUT } from "./bridge";
import { GATE_LAYOUT } from "./gate";
import { DOUBLE_PYRAMID_LAYOUT } from "./double_pyramid";
import { ANCHOR_LAYOUT } from "./anchor";
import { CROWN_LAYOUT } from "./crown";
import { SHIELD_LAYOUT } from "./shield";
import { HEART_LAYOUT } from "./heart";
import { HOURGLASS_LAYOUT } from "./hourglass";
import { THE_KEY_LAYOUT } from "./the_key";
import { DIAMOND_LAYOUT } from "./diamond";
import { X_WING_LAYOUT } from "./x_wing";
import { MAZE_LAYOUT } from "./maze";
import { ZIG_ZAG_LAYOUT } from "./zig_zag";
import { CONCENTRIC_SQUARES_LAYOUT } from "./concentric_squares";

export const LAYOUTS: LayoutMeta[] = [
  {
    id: "turtle",
    name: "Turtle",
    tier: 1,
    tileCount: 144,
    data: TURTLE_LAYOUT,
  },
  {
    id: "pyramid",
    name: "Pyramid",
    tier: 1,
    tileCount: 144,
    data: PYRAMID_LAYOUT,
  },
  {
    id: "square",
    name: "Square",
    tier: 1,
    tileCount: 144,
    data: SQUARE_LAYOUT,
  },
  {
    id: "arena",
    name: "Arena",
    tier: 1,
    tileCount: 144,
    data: ARENA_LAYOUT,
  },
  {
    id: "four_rivers",
    name: "Four Rivers",
    tier: 1,
    tileCount: 144,
    data: FOUR_RIVERS_LAYOUT,
  },
  {
    id: "butterfly",
    name: "Butterfly",
    tier: 2,
    tileCount: 144,
    data: BUTTERFLY_LAYOUT,
  },
  {
    id: "fish",
    name: "Fish",
    tier: 2,
    tileCount: 144,
    data: FISH_LAYOUT,
  },
  {
    id: "spider",
    name: "Spider",
    tier: 2,
    tileCount: 144,
    data: SPIDER_LAYOUT,
  },
  {
    id: "cat",
    name: "Cat",
    tier: 2,
    tileCount: 144,
    data: CAT_LAYOUT,
  },
  {
    id: "snowflake",
    name: "Snowflake",
    tier: 2,
    tileCount: 144,
    data: SNOWFLAKE_LAYOUT,
  },
  {
    id: "castle",
    name: "Castle",
    tier: 2,
    tileCount: 144,
    data: CASTLE_LAYOUT,
  },
  {
    id: "bridge",
    name: "Bridge",
    tier: 2,
    tileCount: 144,
    data: BRIDGE_LAYOUT,
  },
  {
    id: "gate",
    name: "Gate",
    tier: 2,
    tileCount: 144,
    data: GATE_LAYOUT,
  },
  {
    id: "double_pyramid",
    name: "Double Pyramid",
    tier: 2,
    tileCount: 144,
    data: DOUBLE_PYRAMID_LAYOUT,
  },
  {
    id: "anchor",
    name: "Anchor",
    tier: 2,
    tileCount: 144,
    data: ANCHOR_LAYOUT,
  },
  {
    id: "crown",
    name: "Crown",
    tier: 2,
    tileCount: 144,
    data: CROWN_LAYOUT,
  },
  {
    id: "shield",
    name: "Shield",
    tier: 2,
    tileCount: 144,
    data: SHIELD_LAYOUT,
  },
  {
    id: "heart",
    name: "Heart",
    tier: 2,
    tileCount: 144,
    data: HEART_LAYOUT,
  },
  {
    id: "hourglass",
    name: "Hourglass",
    tier: 2,
    tileCount: 144,
    data: HOURGLASS_LAYOUT,
  },
  {
    id: "the_key",
    name: "The Key",
    tier: 2,
    tileCount: 144,
    data: THE_KEY_LAYOUT,
  },
  {
    id: "diamond",
    name: "Diamond",
    tier: 2,
    tileCount: 144,
    data: DIAMOND_LAYOUT,
  },
  {
    id: "x_wing",
    name: "X-Wing",
    tier: 2,
    tileCount: 144,
    data: X_WING_LAYOUT,
  },
  {
    id: "maze",
    name: "Maze",
    tier: 2,
    tileCount: 144,
    data: MAZE_LAYOUT,
  },
  {
    id: "zig_zag",
    name: "Zig-Zag",
    tier: 2,
    tileCount: 144,
    data: ZIG_ZAG_LAYOUT,
  },
  {
    id: "concentric_squares",
    name: "Concentric Squares",
    tier: 2,
    tileCount: 144,
    data: CONCENTRIC_SQUARES_LAYOUT,
  },
];

// Validate every layout once at module init (count + duplicate coordinates):
// a malformed layout throws on first import of the registry, and getLayout()
// is O(1) at call time.
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
