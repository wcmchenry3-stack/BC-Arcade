import { TIERS, type TierSetId } from "../game/cascade/tiers";
// Names, emoji and placeholder colours only: radius, score and density live in
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
    // The emoji are dev-panel / fallback only (the art is code-drawn); the colours are live: they
    // colour each merge's burst (`CascadeScreen`: `mergeBursts.add`), so keep them equal to the
    // fruit's `CASCADE_PIECE_COLORS` entry. Unicode has no lychee, plum or pomegranate emoji, so
    // those three borrow the nearest one: 🍓 (a bumpy red shell), 🍑 (a stone fruit) and 🍎 (a red
    // fruit with a calyx). Lime is 🍋‍🟩 (Emoji 15.1; platforms without the sequence show a lemon
    // followed by a green square, two glyphs, which is harmless in the dev panel).
    label: "Fruits",
    fruits: [
      {
        tier: 0,
        name: "Cherry",
        emoji: "🍒",
        color: "#dc2626",
      },
      {
        tier: 1,
        name: "Lychee",
        emoji: "🍓",
        color: "#e4546a",
      },
      {
        tier: 2,
        name: "Lime",
        emoji: "🍋‍🟩",
        color: "#2f8f2a",
      },
      {
        tier: 3,
        name: "Lemon",
        emoji: "🍋",
        color: "#ca8a04",
      },
      {
        tier: 4,
        name: "Plum",
        emoji: "🍑",
        color: "#d63a5c",
      },
      {
        tier: 5,
        name: "Orange",
        emoji: "🍊",
        color: "#ea580c",
      },
      {
        tier: 6,
        name: "Apple",
        emoji: "🍏",
        color: "#65a30d",
      },
      {
        tier: 7,
        name: "Pomegranate",
        emoji: "🍎",
        color: "#c4262e",
      },
      {
        tier: 8,
        name: "Dragonfruit",
        emoji: "🐉",
        color: "#db2777",
      },
      {
        tier: 9,
        name: "Pineapple",
        emoji: "🍍",
        color: "#ca8a04",
      },
      {
        tier: 10,
        name: "Watermelon",
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
        name: "Pluto",
        emoji: "🪨",
        color: "#94a3b8",
      },
      {
        tier: 1,
        name: "Moon",
        emoji: "🌕",
        color: "#cbd5e1",
      },
      {
        tier: 2,
        name: "Mercury",
        emoji: "🪨",
        color: "#9ca3af",
      },
      {
        tier: 3,
        name: "Mars",
        emoji: "🔴",
        color: "#dc2626",
      },
      {
        tier: 4,
        name: "Venus",
        emoji: "🟡",
        color: "#fbbf24",
      },
      {
        tier: 5,
        name: "Earth",
        emoji: "🌍",
        color: "#2563eb",
      },
      {
        tier: 6,
        name: "Neptune",
        emoji: "🔵",
        color: "#1d4ed8",
      },
      {
        tier: 7,
        name: "Uranus",
        emoji: "🩵",
        color: "#67e8f9",
      },
      {
        tier: 8,
        name: "Saturn",
        emoji: "🪐",
        color: "#ca8a04",
      },
      {
        tier: 9,
        name: "Jupiter",
        emoji: "🟠",
        color: "#ea580c",
      },
      {
        tier: 10,
        name: "Sun",
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
        set: setId,
        i18nKey: `${setId}.${TIERS[f.tier]!.nameKeys[setId]}`,
      })),
    },
  ])
);

export const DEFAULT_FRUIT_SET = "fruits";
