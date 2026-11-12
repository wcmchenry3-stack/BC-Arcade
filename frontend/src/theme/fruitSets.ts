import { ImageSourcePropType } from "react-native";

import { TIERS, type TierSetId } from "../game/cascade/tiers";
import { COSMOS_BAKED, COSMOS_ICONS, FRUIT_BAKED, FRUIT_ICONS } from "../game/cascade/images";
// Names, emoji, colours and sprite refs only: radius, score and density live in
// game/cascade/tiers.ts (#3695).
import type { FruitDefinition as FruitDefinitionBase } from "./fruitSets.engine";

export type { FruitTier } from "./fruitSets.engine";

export interface FruitDefinition extends FruitDefinitionBase {
  icon?: ImageSourcePropType;
  /** Pre-baked game canvas PNG — composited, clipped, ready for a single drawImage. */
  bakedIcon?: ImageSourcePropType;
  /**
   * Sprite canvas half-size per unit of fruit radius (= clipR / radius, from
   * tools/assets/bake_sprites.py). At render time: half-size = bakedClipR * tier radius, where
   * the radius is the ONE ladder radius (`game/cascade/tiers.ts`, `spriteHalfSize`), so the
   * visible fruit matches the collider. Tier 11 has no sprite yet (placeholder circle until the
   * art story, #3698).
   */
  bakedClipR?: number;
}

/** A fruit as written in the set tables; the i18n key is added from the ladder below. */
type SetFruit = Omit<FruitDefinition, "i18nKey">;

export interface FruitSet {
  id: string;
  label: string;
  fruits: FruitDefinition[];
}

const SET_DEFS: Record<TierSetId, Omit<FruitSet, "fruits"> & { fruits: SetFruit[] }> = {
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
      },
      {
        tier: 1,
        name: "Blueberry",
        icon: FRUIT_ICONS.blueberry,
        bakedIcon: FRUIT_BAKED.blueberry,
        bakedClipR: 1.650521,
        emoji: "🫐",
        color: "#6d28d9",
      },
      {
        tier: 2,
        name: "Lemon",
        icon: FRUIT_ICONS.lemon,
        bakedIcon: FRUIT_BAKED.lemon,
        bakedClipR: 2.225986,
        emoji: "🍋",
        color: "#ca8a04",
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
      },
      {
        tier: 4,
        name: "Orange",
        icon: FRUIT_ICONS.orange,
        bakedIcon: FRUIT_BAKED.orange,
        bakedClipR: 2.114153,
        emoji: "🍊",
        color: "#ea580c",
      },
      {
        tier: 5,
        name: "Apple",
        icon: FRUIT_ICONS.apple,
        bakedIcon: FRUIT_BAKED.apple,
        bakedClipR: 1.863585,
        emoji: "🍎",
        color: "#dc2626",
      },
      {
        tier: 6,
        name: "Peach",
        icon: FRUIT_ICONS.peach,
        bakedIcon: FRUIT_BAKED.peach,
        bakedClipR: 1.654107,
        emoji: "🍑",
        color: "#f97316",
      },
      {
        tier: 7,
        name: "Coconut",
        icon: FRUIT_ICONS.coconut,
        bakedIcon: FRUIT_BAKED.coconut,
        bakedClipR: 1.480577,
        emoji: "🥥",
        color: "#78716c",
      },
      {
        tier: 8,
        name: "Dragonfruit",
        icon: FRUIT_ICONS.dragonfruit,
        bakedIcon: FRUIT_BAKED.dragonfruit,
        bakedClipR: 1.577306,
        emoji: "🐉",
        color: "#db2777",
      },
      {
        tier: 9,
        name: "Pineapple",
        icon: FRUIT_ICONS.pineapple,
        bakedIcon: FRUIT_BAKED.pineapple,
        bakedClipR: 1.169323,
        emoji: "🍍",
        color: "#ca8a04",
      },
      {
        tier: 10,
        name: "Watermelon",
        icon: FRUIT_ICONS.watermelon,
        bakedIcon: FRUIT_BAKED.watermelon,
        bakedClipR: 1.026839,
        emoji: "🍉",
        color: "#16a34a",
      },
      {
        tier: 11,
        name: "Pumpkin",
        emoji: "🎃",
        color: "#ea580c",
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
      },
      {
        tier: 1,
        name: "Pluto",
        icon: COSMOS_ICONS.pluto,
        bakedIcon: COSMOS_BAKED.pluto,
        bakedClipR: 2.472627,
        emoji: "🪨",
        color: "#94a3b8",
      },
      {
        tier: 2,
        name: "Mercury",
        icon: COSMOS_ICONS.mercury,
        bakedIcon: COSMOS_BAKED.mercury,
        bakedClipR: 2.57749,
        emoji: "🪨",
        color: "#9ca3af",
      },
      {
        tier: 3,
        name: "Mars",
        icon: COSMOS_ICONS.mars,
        bakedIcon: COSMOS_BAKED.mars,
        bakedClipR: 2.370837,
        emoji: "🔴",
        color: "#dc2626",
      },
      {
        tier: 4,
        name: "Venus",
        icon: COSMOS_ICONS.venus,
        bakedIcon: COSMOS_BAKED.venus,
        bakedClipR: 2.358557,
        emoji: "🟡",
        color: "#fbbf24",
      },
      {
        tier: 5,
        name: "Earth",
        icon: COSMOS_ICONS.earth,
        bakedIcon: COSMOS_BAKED.earth,
        bakedClipR: 2.096224,
        emoji: "🌍",
        color: "#2563eb",
      },
      {
        tier: 6,
        name: "Neptune",
        icon: COSMOS_ICONS.neptune,
        bakedIcon: COSMOS_BAKED.neptune,
        bakedClipR: 1.854684,
        emoji: "🔵",
        color: "#1d4ed8",
      },
      {
        tier: 7,
        name: "Uranus",
        icon: COSMOS_ICONS.uranus,
        bakedIcon: COSMOS_BAKED.uranus,
        bakedClipR: 1.732907,
        emoji: "🩵",
        color: "#67e8f9",
      },
      {
        tier: 8,
        name: "Saturn",
        icon: COSMOS_ICONS.saturn,
        bakedIcon: COSMOS_BAKED.saturn,
        bakedClipR: 1.694863,
        emoji: "🪐",
        color: "#ca8a04",
      },
      {
        tier: 9,
        name: "Jupiter",
        icon: COSMOS_ICONS.jupiter,
        bakedIcon: COSMOS_BAKED.jupiter,
        bakedClipR: 1.502071,
        emoji: "🟠",
        color: "#ea580c",
      },
      {
        tier: 10,
        name: "Sun",
        icon: COSMOS_ICONS.sun,
        bakedIcon: COSMOS_BAKED.sun,
        bakedClipR: 1.328692,
        emoji: "☀️",
        color: "#facc15",
      },
      {
        tier: 11,
        name: "Milky Way",
        emoji: "🌌",
        color: "#7c3aed",
      },
    ],
  },
};

/** Each fruit gets its i18n key (`<set>.<key>` under `cascade:pieces.`) from the ladder. */
export const FRUIT_SETS: Record<string, FruitSet> = Object.fromEntries(
  (Object.keys(SET_DEFS) as TierSetId[]).map((setId) => [
    setId,
    {
      ...SET_DEFS[setId],
      fruits: SET_DEFS[setId].fruits.map((f) => ({
        ...f,
        i18nKey: `${setId}.${TIERS[f.tier]!.nameKeys[setId]}`,
      })),
    },
  ])
);

export const DEFAULT_FRUIT_SET = "fruits";
