import { CASCADE_PIECE_COLORS } from "../../theme/theme.cascade";

export type Vec2 = { x: number; y: number };

export type ShapeDef =
  { kind: "circle"; radius: number } | { kind: "convex"; vertices: Vec2[]; boundingRadius: number };

export interface PieceDef {
  tier: number;
  label: string;
  /**
   * Placeholder colour (`theme/theme.cascade.ts`): the plain circle drawn for a tier whose
   * sprite hasn't decoded yet (a brief fallback players can see), and the dev panel's swatch.
   * The intended look comes from the active fruit set's art; don't use this colour for
   * anything else player-facing.
   */
  color: string;
  scoreValue: number;
  shape: ShapeDef; // physics + collision shape — lives HERE, not in a separate file
  sprite?: SpriteRef;
}

export interface SpriteRef {
  assetKey: string; // key into the asset registry
  offsetX?: number; // sprite origin offset to align with physics centroid
  offsetY?: number;
  scale?: number;
}

// scoreValues follow triangular numbers T(1)–T(10): 1, 3, 6, 10, 15, 21, 28, 36, 45, 55
export const PIECE_DEFS: PieceDef[] = [
  {
    tier: 0,
    label: "Cherry",
    color: CASCADE_PIECE_COLORS[0],
    scoreValue: 1,
    shape: { kind: "circle", radius: 16 },
  },
  {
    tier: 1,
    label: "Strawberry",
    color: CASCADE_PIECE_COLORS[1],
    scoreValue: 3,
    shape: { kind: "circle", radius: 22 },
  },
  {
    tier: 2,
    label: "Grape",
    color: CASCADE_PIECE_COLORS[2],
    scoreValue: 6,
    shape: { kind: "circle", radius: 28 },
  },
  {
    tier: 3,
    label: "Orange",
    color: CASCADE_PIECE_COLORS[3],
    scoreValue: 10,
    shape: { kind: "circle", radius: 36 },
  },
  {
    tier: 4,
    label: "Apple",
    color: CASCADE_PIECE_COLORS[4],
    scoreValue: 15,
    shape: { kind: "circle", radius: 44 },
  },
  {
    tier: 5,
    label: "Pear",
    color: CASCADE_PIECE_COLORS[5],
    scoreValue: 21,
    shape: { kind: "circle", radius: 52 },
  },
  {
    tier: 6,
    label: "Peach",
    color: CASCADE_PIECE_COLORS[6],
    scoreValue: 28,
    shape: { kind: "circle", radius: 62 },
  },
  // placeholder — update to convex when art ready
  {
    tier: 7,
    label: "Pineapple",
    color: CASCADE_PIECE_COLORS[7],
    scoreValue: 36,
    shape: { kind: "circle", radius: 72 },
  },
  {
    tier: 8,
    label: "Melon",
    color: CASCADE_PIECE_COLORS[8],
    scoreValue: 45,
    shape: { kind: "circle", radius: 82 },
  },
  {
    tier: 9,
    label: "Watermelon",
    color: CASCADE_PIECE_COLORS[9],
    scoreValue: 55,
    shape: { kind: "circle", radius: 92 },
  },
];

export const MAX_TIER = PIECE_DEFS.length - 1;
export const DROPPABLE_PIECE_TIERS = [0, 1, 2, 3, 4];
