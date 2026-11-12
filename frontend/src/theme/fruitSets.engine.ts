export type FruitTier = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11;

export interface FruitDefinition {
  tier: FruitTier;
  name: string;
  nameKey?: string;
  /** `<set>.<key>`: the piece name is `cascade:pieces.<i18nKey>` (keys from `game/cascade/tiers.ts`). */
  i18nKey: string;
  emoji: string;
  color: string;
}

export interface FruitSet {
  id: string;
  label: string;
  fruits: FruitDefinition[];
}
