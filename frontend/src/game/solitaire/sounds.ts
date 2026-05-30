export const SOLITAIRE_SOUNDS: Record<string, number> = {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.cardFlip": require("../../../assets/sounds/solitaire-card-flip.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.cardPlace": require("../../../assets/sounds/solitaire-card-place.ogg"),
  // shared file with blackjack.win (#1025)
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.foundationComplete": require("../../../assets/sounds/blackjack-win.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.invalidMove": require("../../../assets/sounds/solitaire-invalid-move.ogg"),
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  "solitaire.gameWin": require("../../../assets/sounds/hearts-moon-shot.mp3"),
};
