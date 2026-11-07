export const SOLITAIRE_SOUNDS: Record<string, number> = {
  // card flip (Draw 1, a revealed card) and the Draw-3 fan: three variations each (#3563)
  "solitaire.cardFlip": require("../../../assets/sounds/card-flip-1.ogg"),
  "solitaire.cardFlip2": require("../../../assets/sounds/card-flip-2.ogg"),
  "solitaire.cardFlip3": require("../../../assets/sounds/card-flip-3.ogg"),
  "solitaire.cardFan": require("../../../assets/sounds/card-fan-1.ogg"),
  "solitaire.cardFan2": require("../../../assets/sounds/card-fan-2.ogg"),
  "solitaire.cardFan3": require("../../../assets/sounds/card-fan-3.ogg"),
  // card place: three variations played by useSoundVariants, shared by Solitaire, FreeCell and Hearts (#3563)
  "solitaire.cardPlace": require("../../../assets/sounds/card-place-1.ogg"),
  "solitaire.cardPlace2": require("../../../assets/sounds/card-place-2.ogg"),
  "solitaire.cardPlace3": require("../../../assets/sounds/card-place-3.ogg"),
  "solitaire.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  // game won: shared by Solitaire, FreeCell and Hearts; plays with the riffle's settle (#3563)
  "solitaire.gameWin": require("../../../assets/sounds/card-game-won.ogg"),
  // Auto-Complete riffle: start + loop + settle, played by useRunSound (#3563)
  "solitaire.autoCompleteStart": require("../../../assets/sounds/riffle-start.ogg"),
  "solitaire.autoCompleteLoop": require("../../../assets/sounds/riffle-loop.ogg"),
  "solitaire.autoCompleteSettle": require("../../../assets/sounds/riffle-settle.ogg"),
};

/** The card place variations, in registry order, for `useSoundVariants` (#3563). */
export const SOLITAIRE_CARD_PLACE = [
  "solitaire.cardPlace",
  "solitaire.cardPlace2",
  "solitaire.cardPlace3",
] as const;

/** The Auto-Complete riffle's parts, for `useRunSound` (#3563). */
export const SOLITAIRE_AUTO_COMPLETE = {
  start: "solitaire.autoCompleteStart",
  loop: "solitaire.autoCompleteLoop",
  settle: "solitaire.autoCompleteSettle",
} as const;

/** The card flip variations, for `useSoundVariants` (#3563). */
export const SOLITAIRE_CARD_FLIP = [
  "solitaire.cardFlip",
  "solitaire.cardFlip2",
  "solitaire.cardFlip3",
] as const;

/** The Draw-3 fan variations, for `useSoundVariants` (#3563). */
export const SOLITAIRE_CARD_FAN = [
  "solitaire.cardFan",
  "solitaire.cardFan2",
  "solitaire.cardFan3",
] as const;
