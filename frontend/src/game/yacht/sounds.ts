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
  "yacht.straight": require("../../../assets/sounds/yacht-straight.ogg"),
  "yacht.upperBonus": require("../../../assets/sounds/yacht-upper-bonus.ogg"),
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
