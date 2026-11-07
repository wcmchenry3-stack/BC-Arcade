export const YACHT_SOUNDS: Record<string, number> = {
  // dice roll: three synthesized variations played by useSoundVariants (#3578)
  "yacht.diceRoll": require("../../../assets/sounds/dice-roll-1.ogg"),
  "yacht.diceRoll2": require("../../../assets/sounds/dice-roll-2.ogg"),
  "yacht.diceRoll3": require("../../../assets/sounds/dice-roll-3.ogg"),
  "yacht.dieHold": require("../../../assets/sounds/yacht-die-hold.ogg"),
  "yacht.yacht": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  "yacht.joker": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  "yacht.straight": require("../../../assets/sounds/yacht-straight.ogg"),
  "yacht.upperBonus": require("../../../assets/sounds/yacht-upper-bonus.ogg"),
};

/** The dice roll variations, in registry order, for `useSoundVariants` (#3578). */
export const YACHT_DICE_ROLL = ["yacht.diceRoll", "yacht.diceRoll2", "yacht.diceRoll3"] as const;
