export const FREECELL_SOUNDS: Record<string, number> = {
  // card place: three variations played by useSoundVariants, shared by Solitaire, FreeCell and Hearts (#3563)
  "freecell.cardPlace": require("../../../assets/sounds/card-place-1.ogg"),
  "freecell.cardPlace2": require("../../../assets/sounds/card-place-2.ogg"),
  "freecell.cardPlace3": require("../../../assets/sounds/card-place-3.ogg"),
  "freecell.supermove": require("../../../assets/sounds/freecell-supermove.mp3"),
  "freecell.gameWin": require("../../../assets/sounds/freecell-game-win.mp3"),
  // shared file with solitaire.invalidMove, sudoku.errorEntered (#1025)
  "freecell.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
};

/** The card place variations, in registry order, for `useSoundVariants` (#3563). */
export const FREECELL_CARD_PLACE = [
  "freecell.cardPlace",
  "freecell.cardPlace2",
  "freecell.cardPlace3",
] as const;
