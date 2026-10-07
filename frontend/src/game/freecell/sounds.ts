export const FREECELL_SOUNDS: Record<string, number> = {
  "freecell.cardPlace": require("../../../assets/sounds/freecell-card-place.mp3"),
  "freecell.supermove": require("../../../assets/sounds/freecell-supermove.mp3"),
  "freecell.foundationComplete": require("../../../assets/sounds/freecell-foundation-complete.mp3"),
  "freecell.gameWin": require("../../../assets/sounds/freecell-game-win.mp3"),
  // shared file with solitaire.invalidMove, sudoku.errorEntered (#1025)
  "freecell.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
};
