import { ImageSourcePropType } from "react-native";

import { COSMOS_BAKED, COSMOS_ICONS, FRUIT_BAKED, FRUIT_ICONS } from "../game/_shared/images";
import type { FruitDefinition as FruitDefinitionBase } from "./fruitSets.engine";

export type { FruitTier } from "./fruitSets.engine";
export { MAX_SPAWN_TIER } from "./fruitSets.engine";
import type { FruitTier } from "./fruitSets.engine";

export interface FruitDefinition extends FruitDefinitionBase {
  icon?: ImageSourcePropType;
  /** Pre-baked game canvas PNG — composited, clipped, ready for a single drawImage. */
  bakedIcon?: ImageSourcePropType;
  /**
   * Normalised clip radius of the baked PNG (= clipR / physics radius).
   * At render time: half-size = bakedClipR * def.radius
   * Originally produced by scripts/bake_sprites.py. When physics radii change
   * without a sprite rebake, rescale as: new = old * (old_radius / new_radius).
   * Re-running bake_sprites.py will overwrite these with authoritative values.
   */
  bakedClipR?: number;
}

export interface FruitSet {
  id: string;
  label: string;
  fruits: FruitDefinition[];
}

// Radii scale with tier — same across all sets so physics is skin-agnostic
// Geometric series: r_n = 18 × 1.25^n, rounded to the nearest integer.
const RADII: Record<FruitTier, number> = {
  0: 18,
  1: 23,
  2: 28,
  3: 35,
  4: 44,
  5: 55,
  6: 69,
  7: 86,
  8: 107,
  9: 134,
  10: 168,
};

// Score doubles each tier (cherry merge = 1, watermelon merge = 1024)
const SCORE_VALUES: Record<FruitTier, number> = {
  0: 1,
  1: 2,
  2: 4,
  3: 8,
  4: 16,
  5: 32,
  6: 64,
  7: 128,
  8: 256,
  9: 512,
  10: 1024,
};

export const FRUIT_SETS: Record<string, FruitSet> = {
  fruits: {
    id: "fruits",
    label: "Fruits",
    fruits: [
      {
        tier: 0,
        name: "Cherry",
        icon: FRUIT_ICONS.cherry,
        bakedIcon: FRUIT_BAKED.cherry,
        bakedClipR: 3.225928,
        emoji: "🍒",
        color: "#dc2626",
        radius: RADII[0],
        scoreValue: SCORE_VALUES[0],
      },
      {
        tier: 1,
        name: "Blueberry",
        icon: FRUIT_ICONS.blueberry,
        bakedIcon: FRUIT_BAKED.blueberry,
        bakedClipR: 1.650521,
        emoji: "🫐",
        color: "#6d28d9",
        radius: RADII[1],
        scoreValue: SCORE_VALUES[1],
      },
      {
        tier: 2,
        name: "Lemon",
        icon: FRUIT_ICONS.lemon,
        bakedIcon: FRUIT_BAKED.lemon,
        bakedClipR: 2.225986,
        emoji: "🍋",
        color: "#ca8a04",
        radius: RADII[2],
        scoreValue: SCORE_VALUES[2],
      },
      {
        tier: 3,
        name: "Grape",
        nameKey: "grapes", // PNG filename is grapes.png, not grape.png
        icon: FRUIT_ICONS.grape,
        bakedIcon: FRUIT_BAKED.grape,
        bakedClipR: 1.616115,
        emoji: "🍇",
        color: "#7c3aed",
        radius: RADII[3],
        scoreValue: SCORE_VALUES[3],
      },
      {
        tier: 4,
        name: "Orange",
        icon: FRUIT_ICONS.orange,
        bakedIcon: FRUIT_BAKED.orange,
        bakedClipR: 2.114153,
        emoji: "🍊",
        color: "#ea580c",
        radius: RADII[4],
        scoreValue: SCORE_VALUES[4],
      },
      {
        tier: 5,
        name: "Apple",
        icon: FRUIT_ICONS.apple,
        bakedIcon: FRUIT_BAKED.apple,
        bakedClipR: 1.863585,
        emoji: "🍎",
        color: "#dc2626",
        radius: RADII[5],
        scoreValue: SCORE_VALUES[5],
      },
      {
        tier: 6,
        name: "Peach",
        icon: FRUIT_ICONS.peach,
        bakedIcon: FRUIT_BAKED.peach,
        bakedClipR: 1.654107,
        emoji: "🍑",
        color: "#f97316",
        radius: RADII[6],
        scoreValue: SCORE_VALUES[6],
      },
      {
        tier: 7,
        name: "Coconut",
        icon: FRUIT_ICONS.coconut,
        bakedIcon: FRUIT_BAKED.coconut,
        bakedClipR: 1.480577,
        emoji: "🥥",
        color: "#78716c",
        radius: RADII[7],
        scoreValue: SCORE_VALUES[7],
      },
      {
        tier: 8,
        name: "Dragonfruit",
        icon: FRUIT_ICONS.dragonfruit,
        bakedIcon: FRUIT_BAKED.dragonfruit,
        bakedClipR: 1.319955,
        emoji: "🐉",
        color: "#db2777",
        radius: RADII[8],
        scoreValue: SCORE_VALUES[8],
      },
      {
        tier: 9,
        name: "Pineapple",
        icon: FRUIT_ICONS.pineapple,
        bakedIcon: FRUIT_BAKED.pineapple,
        bakedClipR: 1.169323,
        emoji: "🍍",
        color: "#ca8a04",
        radius: RADII[9],
        scoreValue: SCORE_VALUES[9],
      },
      {
        tier: 10,
        name: "Watermelon",
        icon: FRUIT_ICONS.watermelon,
        bakedIcon: FRUIT_BAKED.watermelon,
        bakedClipR: 1.026839,
        emoji: "🍉",
        color: "#16a34a",
        radius: RADII[10],
        scoreValue: SCORE_VALUES[10],
      },
    ],
  },
  cosmos: {
    id: "cosmos",
    label: "Cosmos",
    fruits: [
      {
        tier: 0,
        name: "Moon",
        icon: COSMOS_ICONS.moon,
        bakedIcon: COSMOS_BAKED.moon,
        bakedClipR: 2.187446,
        emoji: "🌙",
        color: "#d1d5db",
        radius: RADII[0],
        scoreValue: SCORE_VALUES[0],
      },
      {
        tier: 1,
        name: "Pluto",
        icon: COSMOS_ICONS.pluto,
        bakedIcon: COSMOS_BAKED.pluto,
        bakedClipR: 2.472627,
        emoji: "🪨",
        color: "#94a3b8",
        radius: RADII[1],
        scoreValue: SCORE_VALUES[1],
      },
      {
        tier: 2,
        name: "Mercury",
        icon: COSMOS_ICONS.mercury,
        bakedIcon: COSMOS_BAKED.mercury,
        bakedClipR: 2.57749,
        emoji: "🪨",
        color: "#9ca3af",
        radius: RADII[2],
        scoreValue: SCORE_VALUES[2],
      },
      {
        tier: 3,
        name: "Mars",
        icon: COSMOS_ICONS.mars,
        bakedIcon: COSMOS_BAKED.mars,
        bakedClipR: 2.370837,
        emoji: "🔴",
        color: "#dc2626",
        radius: RADII[3],
        scoreValue: SCORE_VALUES[3],
      },
      {
        tier: 4,
        name: "Venus",
        icon: COSMOS_ICONS.venus,
        bakedIcon: COSMOS_BAKED.venus,
        bakedClipR: 2.358557,
        emoji: "🟡",
        color: "#fbbf24",
        radius: RADII[4],
        scoreValue: SCORE_VALUES[4],
      },
      {
        tier: 5,
        name: "Earth",
        icon: COSMOS_ICONS.earth,
        bakedIcon: COSMOS_BAKED.earth,
        bakedClipR: 2.096224,
        emoji: "🌍",
        color: "#2563eb",
        radius: RADII[5],
        scoreValue: SCORE_VALUES[5],
      },
      {
        tier: 6,
        name: "Neptune",
        icon: COSMOS_ICONS.neptune,
        bakedIcon: COSMOS_BAKED.neptune,
        bakedClipR: 1.854684,
        emoji: "🔵",
        color: "#1d4ed8",
        radius: RADII[6],
        scoreValue: SCORE_VALUES[6],
      },
      {
        tier: 7,
        name: "Uranus",
        icon: COSMOS_ICONS.uranus,
        bakedIcon: COSMOS_BAKED.uranus,
        bakedClipR: 1.732907,
        emoji: "🩵",
        color: "#67e8f9",
        radius: RADII[7],
        scoreValue: SCORE_VALUES[7],
      },
      {
        tier: 8,
        name: "Saturn",
        icon: COSMOS_ICONS.saturn,
        bakedIcon: COSMOS_BAKED.saturn,
        bakedClipR: 1.694863,
        emoji: "🪐",
        color: "#ca8a04",
        radius: RADII[8],
        scoreValue: SCORE_VALUES[8],
      },
      {
        tier: 9,
        name: "Jupiter",
        icon: COSMOS_ICONS.jupiter,
        bakedIcon: COSMOS_BAKED.jupiter,
        bakedClipR: 1.502071,
        emoji: "🟠",
        color: "#ea580c",
        radius: RADII[9],
        scoreValue: SCORE_VALUES[9],
      },
      {
        tier: 10,
        name: "Sun",
        icon: COSMOS_ICONS.sun,
        bakedIcon: COSMOS_BAKED.sun,
        bakedClipR: 1.328692,
        emoji: "☀️",
        color: "#facc15",
        radius: RADII[10],
        scoreValue: SCORE_VALUES[10],
      },
    ],
  },
};

export const DEFAULT_FRUIT_SET = "fruits";
