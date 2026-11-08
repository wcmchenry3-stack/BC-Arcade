export const YACHT_SOUNDS: Record<string, number> = {
  // dice roll: three synthesized variations played by useSoundVariants (#3578)
  "yacht.diceRoll": require("../../../assets/sounds/dice-roll-1.ogg"),
  "yacht.diceRoll2": require("../../../assets/sounds/dice-roll-2.ogg"),
  "yacht.diceRoll3": require("../../../assets/sounds/dice-roll-3.ogg"),
  // die hold ("pick up") and release ("set down"): three variations each (#3578)
  "yacht.dieHold": require("../../../assets/sounds/die-hold-1.ogg"),
  "yacht.dieHold2": require("../../../assets/sounds/die-hold-2.ogg"),
  "yacht.dieHold3": require("../../../assets/sounds/die-hold-3.ogg"),
  "yacht.dieRelease": require("../../../assets/sounds/die-release-1.ogg"),
  "yacht.dieRelease2": require("../../../assets/sounds/die-release-2.ogg"),
  "yacht.dieRelease3": require("../../../assets/sounds/die-release-3.ogg"),
  "yacht.yacht": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  "yacht.joker": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // scoring ladder, "wood and mallet": one sound per score, a milestone replaces the commit (#3578)
  "yacht.scoreCommit": require("../../../assets/sounds/score-commit.ogg"),
  "yacht.scoreZero": require("../../../assets/sounds/score-zero.ogg"),
  "yacht.smallStraight": require("../../../assets/sounds/small-straight.ogg"),
  "yacht.largeStraight": require("../../../assets/sounds/large-straight.ogg"),
  "yacht.fullHouse": require("../../../assets/sounds/full-house.ogg"),
  "yacht.upperBonus": require("../../../assets/sounds/upper-bonus.ogg"),
  // the computer's "rival" versions: falling, minor, darker, quieter, short (#3578)
  "yacht.cpuScoreCommit": require("../../../assets/sounds/cpu-score-commit.ogg"),
  "yacht.cpuScoreZero": require("../../../assets/sounds/cpu-score-zero.ogg"),
  "yacht.cpuSmallStraight": require("../../../assets/sounds/cpu-small-straight.ogg"),
  "yacht.cpuLargeStraight": require("../../../assets/sounds/cpu-large-straight.ogg"),
  "yacht.cpuFullHouse": require("../../../assets/sounds/cpu-full-house.ogg"),
  "yacht.cpuUpperBonus": require("../../../assets/sounds/cpu-upper-bonus.ogg"),
};

/** The dice roll variations, in registry order, for `useSoundVariants` (#3578). */
export const YACHT_DICE_ROLL = ["yacht.diceRoll", "yacht.diceRoll2", "yacht.diceRoll3"] as const;

/** The die hold variations, in registry order, for `useSoundVariants` (#3578). */
export const YACHT_DIE_HOLD = ["yacht.dieHold", "yacht.dieHold2", "yacht.dieHold3"] as const;

/** The die release variations, in registry order, for `useSoundVariants` (#3578). */
export const YACHT_DIE_RELEASE = [
  "yacht.dieRelease",
  "yacht.dieRelease2",
  "yacht.dieRelease3",
] as const;
