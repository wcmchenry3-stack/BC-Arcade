export const SOLITAIRE_SOUNDS: Record<string, number> = {
  "solitaire.cardFlip": require("../../../assets/sounds/solitaire-card-flip.ogg"),
  // card place: three variations played by useSoundVariants, shared by Solitaire, FreeCell and Hearts (#3563)
  "solitaire.cardPlace": require("../../../assets/sounds/card-place-1.ogg"),
  "solitaire.cardPlace2": require("../../../assets/sounds/card-place-2.ogg"),
  "solitaire.cardPlace3": require("../../../assets/sounds/card-place-3.ogg"),
  "solitaire.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  "solitaire.gameWin": require("../../../assets/sounds/hearts-moon-shot.mp3"),
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
