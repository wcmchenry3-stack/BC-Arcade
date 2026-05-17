export const UPPER_CATEGORY_KEYS = ["ones", "twos", "threes", "fours", "fives", "sixes"] as const;

export const LOWER_CATEGORY_KEYS = [
  "three_of_a_kind",
  "four_of_a_kind",
  "full_house",
  "small_straight",
  "large_straight",
  "yacht",
  "chance",
] as const;

export const CATEGORY_I18N_KEY: Record<string, string> = {
  ones: "category.ones",
  twos: "category.twos",
  threes: "category.threes",
  fours: "category.fours",
  fives: "category.fives",
  sixes: "category.sixes",
  three_of_a_kind: "category.threeOfAKind",
  four_of_a_kind: "category.fourOfAKind",
  full_house: "category.fullHouse",
  small_straight: "category.smallStraight",
  large_straight: "category.largeStraight",
  yacht: "category.yacht",
  chance: "category.chance",
};
