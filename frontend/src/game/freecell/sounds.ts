export const FREECELL_SOUNDS: Record<string, number> = {
  // card place: three variations played by useSoundVariants, shared by Solitaire, FreeCell and Hearts (#3563)
  "freecell.cardPlace": require("../../../assets/sounds/card-place-1.ogg"),
  "freecell.cardPlace2": require("../../../assets/sounds/card-place-2.ogg"),
  "freecell.cardPlace3": require("../../../assets/sounds/card-place-3.ogg"),
  "freecell.supermove": require("../../../assets/sounds/freecell-supermove.mp3"),
  // game won: shared by Solitaire, FreeCell and Hearts; plays with the riffle's settle (#3563)
  "freecell.gameWin": require("../../../assets/sounds/card-game-won.ogg"),
  // shared file with solitaire.invalidMove, sudoku.errorEntered (#1025)
  "freecell.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  // Auto-Complete riffle: start + loop + settle, played by useRunSound (#3563)
  "freecell.autoCompleteStart": require("../../../assets/sounds/riffle-start.ogg"),
  "freecell.autoCompleteLoop": require("../../../assets/sounds/riffle-loop.ogg"),
  "freecell.autoCompleteSettle": require("../../../assets/sounds/riffle-settle.ogg"),
};

/** The card place variations, in registry order, for `useSoundVariants` (#3563). */
export const FREECELL_CARD_PLACE = [
  "freecell.cardPlace",
  "freecell.cardPlace2",
  "freecell.cardPlace3",
] as const;

/** The Auto-Complete riffle's parts, for `useRunSound` (#3563). */
export const FREECELL_AUTO_COMPLETE = {
  start: "freecell.autoCompleteStart",
  loop: "freecell.autoCompleteLoop",
  settle: "freecell.autoCompleteSettle",
} as const;
