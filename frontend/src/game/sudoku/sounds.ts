export const SUDOKU_SOUNDS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.digitPlace": require("../../../assets/sounds/sudoku-digit-place.ogg"),
  // shared file with solitaire.invalidMove, freecell.invalidMove (#1025)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.errorEntered": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.unitComplete": require("../../../assets/sounds/sudoku-unit-complete.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "sudoku.puzzleComplete": require("../../../assets/sounds/hearts-moon-shot.mp3"),
};
