import type { LayoutMeta, Layout } from "../types";
import { parseLayout } from "./loader";

// eslint-disable-next-line @typescript-eslint/no-var-requires
const turtleJson = require("../../../../assets/mahjong/layouts/turtle.json") as {
  col: number;
  row: number;
  layer: number;
}[];

export const LAYOUTS: LayoutMeta[] = [
  {
    id: "turtle",
    name: "Turtle",
    tier: 1,
    tileCount: 144,
    data: turtleJson,
  },
];

/** Look up a layout by its registry ID. Returns the parsed Layout or throws. */
export function getLayout(id: string): Layout {
  const meta = LAYOUTS.find((l) => l.id === id);
  if (!meta) throw new Error(`Layout not found: ${id}`);
  return parseLayout(meta.data, meta.tileCount);
}
