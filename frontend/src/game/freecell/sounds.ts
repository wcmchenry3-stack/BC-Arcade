export const FREECELL_SOUNDS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.cardPlace": require("../../../assets/sounds/freecell-card-place.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.supermove": require("../../../assets/sounds/freecell-supermove.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.foundationComplete": require("../../../assets/sounds/freecell-foundation-complete.mp3"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.gameWin": require("../../../assets/sounds/freecell-game-win.mp3"),
  // shared file with solitaire.invalidMove, sudoku.errorEntered (#1025)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "freecell.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
};
