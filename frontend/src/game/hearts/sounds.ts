export const HEARTS_SOUNDS: Record<string, number> = {
  "hearts.heartsBroken": require("../../../assets/sounds/hearts-broken.mp3"),
  "hearts.moonShot": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  "hearts.queenOfSpades": require("../../../assets/sounds/hearts-queen-of-spades.mp3"),
  // card place: three variations played by useSoundVariants, shared by Solitaire, FreeCell and Hearts (#3563)
  "hearts.cardPlay": require("../../../assets/sounds/card-place-1.ogg"),
  "hearts.cardPlay2": require("../../../assets/sounds/card-place-2.ogg"),
  "hearts.cardPlay3": require("../../../assets/sounds/card-place-3.ogg"),
  "hearts.trickWon": require("../../../assets/sounds/solitaire-card-flip.ogg"),
  "hearts.gameOver": require("../../../assets/sounds/cascade-game-over.ogg"),
};

/** The card place variations, in registry order, for `useSoundVariants` (#3563). */
export const HEARTS_CARD_PLAY = [
  "hearts.cardPlay",
  "hearts.cardPlay2",
  "hearts.cardPlay3",
] as const;
