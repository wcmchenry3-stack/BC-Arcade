import { TIERS, type TierSetId } from "../game/cascade/tiers";
// Names and placeholder colours only: radius, score and density live in
// game/cascade/tiers.ts (#3695); the pieces are drawn in code from game/cascade/art/ (#3698).
import type { FruitDefinition as FruitDefinitionBase } from "./fruitSets.engine";

export type { FruitTier } from "./fruitSets.engine";

export interface FruitDefinition extends FruitDefinitionBase {
  /** The set this piece belongs to: picks its drawing (`game/cascade/art/`). */
  set: TierSetId;
}

/** A fruit as written in the set tables; the i18n key is added from the ladder below. */
type SetFruit = Omit<FruitDefinition, "i18nKey" | "set">;

export interface FruitSet {
  id: string;
  label: string;
  fruits: FruitDefinition[];
}

const SET_DEFS: Record<TierSetId, Omit<FruitSet, "fruits"> & { fruits: SetFruit[] }> = {
  fruits: {
    id: "fruits",
    // The colours are live: they colour each merge's burst (the board's `burstColors`, #4082), so
    // keep them equal to the fruit's `CASCADE_PIECE_COLORS` entry. There are no emoji: the art is
    // code-drawn, and the owner wants no stand-in emoji for the pieces Unicode lacks (#3964).
    label: "Fruits",
    fruits: [
      {
        tier: 0,
        name: "Cherry",
        color: "#dc2626",
      },
      {
        tier: 1,
        name: "Lychee",
        color: "#e4546a",
      },
      {
        tier: 2,
        name: "Lime",
        color: "#2f8f2a",
      },
      {
        tier: 3,
        name: "Lemon",
        color: "#ca8a04",
      },
      {
        tier: 4,
        name: "Plum",
        color: "#d63a5c",
      },
      {
        tier: 5,
        name: "Orange",
        color: "#ea580c",
      },
      {
        tier: 6,
        name: "Apple",
        color: "#65a30d",
      },
      {
        tier: 7,
        name: "Pomegranate",
        color: "#c4262e",
      },
      {
        tier: 8,
        name: "Dragonfruit",
        color: "#db2777",
      },
      {
        tier: 9,
        name: "Pineapple",
        color: "#ca8a04",
      },
      {
        tier: 10,
        name: "Watermelon",
        color: "#16a34a",
      },
      {
        tier: 11,
        name: "Pumpkin",
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
        name: "Pluto",
        color: "#94a3b8",
      },
      {
        tier: 1,
        name: "Moon",
        color: "#cbd5e1",
      },
      {
        tier: 2,
        name: "Mercury",
        color: "#9ca3af",
      },
      {
        tier: 3,
        name: "Mars",
        color: "#dc2626",
      },
      {
        tier: 4,
        name: "Venus",
        color: "#fbbf24",
      },
      {
        tier: 5,
        name: "Earth",
        color: "#2563eb",
      },
      {
        tier: 6,
        name: "Neptune",
        color: "#1d4ed8",
      },
      {
        tier: 7,
        name: "Uranus",
        color: "#67e8f9",
      },
      {
        tier: 8,
        name: "Saturn",
        color: "#ca8a04",
      },
      {
        tier: 9,
        name: "Jupiter",
        color: "#ea580c",
      },
      {
        tier: 10,
        name: "Sun",
        color: "#facc15",
      },
      {
        tier: 11,
        name: "Milky Way",
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
        set: setId,
        i18nKey: `${setId}.${TIERS[f.tier]!.nameKeys[setId]}`,
      })),
    },
  ])
);

export const DEFAULT_FRUIT_SET = "fruits";
