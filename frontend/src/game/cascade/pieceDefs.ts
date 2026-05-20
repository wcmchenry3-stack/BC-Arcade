export type Vec2 = { x: number; y: number };

export type ShapeDef =
  | { kind: "circle"; radius: number }
  | { kind: "convex"; vertices: Vec2[]; boundingRadius: number };

export interface PieceDef {
  tier: number;
  label: string;
  color: string; // hex; used for placeholder rendering and debug
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

export const PIECE_DEFS: PieceDef[] = [
  {
    tier: 0,
    label: "Cherry",
    color: "#e63946",
    scoreValue: 1,
    shape: { kind: "circle", radius: 16 },
  },
  {
    tier: 1,
    label: "Strawberry",
    color: "#f4a261",
    scoreValue: 3,
    shape: { kind: "circle", radius: 22 },
  },
  {
    tier: 2,
    label: "Grape",
    color: "#6a0572",
    scoreValue: 6,
    shape: { kind: "circle", radius: 28 },
  },
  {
    tier: 3,
    label: "Orange",
    color: "#f77f00",
    scoreValue: 10,
    shape: { kind: "circle", radius: 36 },
  },
  {
    tier: 4,
    label: "Apple",
    color: "#e63946",
    scoreValue: 15,
    shape: { kind: "circle", radius: 44 },
  },
  {
    tier: 5,
    label: "Pear",
    color: "#a7c957",
    scoreValue: 21,
    shape: { kind: "circle", radius: 52 },
  },
  {
    tier: 6,
    label: "Peach",
    color: "#ffb347",
    scoreValue: 28,
    shape: { kind: "circle", radius: 62 },
  },
  {
    tier: 7,
    label: "Pineapple",
    color: "#ffd166",
    scoreValue: 36,
    shape: { kind: "circle", radius: 72 },
  }, // placeholder — update to convex when art ready
  {
    tier: 8,
    label: "Melon",
    color: "#06d6a0",
    scoreValue: 45,
    shape: { kind: "circle", radius: 82 },
  },
  {
    tier: 9,
    label: "Watermelon",
    color: "#2d6a4f",
    scoreValue: 55,
    shape: { kind: "circle", radius: 92 },
  },
];

export const MAX_TIER = PIECE_DEFS.length - 1;
export const DROPPABLE_PIECE_TIERS = [0, 1, 2, 3, 4];
