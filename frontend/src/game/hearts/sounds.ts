export const HEARTS_SOUNDS: Record<string, number> = {
  // synthesized for Hearts (#3563): a heartbeat, a wolf howl (the human shoots the moon), a dark gong
  "hearts.heartsBroken": require("../../../assets/sounds/hearts-broken-heartbeat.ogg"),
  "hearts.moonShot": require("../../../assets/sounds/hearts-moon-howl.ogg"),
  "hearts.queenOfSpades": require("../../../assets/sounds/queen-of-spades-gong.ogg"),
  // card place: three variations played by useSoundVariants, shared by Solitaire, FreeCell and Hearts (#3563)
  "hearts.cardPlay": require("../../../assets/sounds/card-place-1.ogg"),
  "hearts.cardPlay2": require("../../../assets/sounds/card-place-2.ogg"),
  "hearts.cardPlay3": require("../../../assets/sounds/card-place-3.ogg"),
  // trick gathered: three variations played by useSoundVariants (#3563)
  "hearts.trickWon": require("../../../assets/sounds/trick-gathered-1.ogg"),
  "hearts.trickWon2": require("../../../assets/sounds/trick-gathered-2.ogg"),
  "hearts.trickWon3": require("../../../assets/sounds/trick-gathered-3.ogg"),
  // game over: won (or tied for the lowest score) vs lost (#3563)
  "hearts.gameWon": require("../../../assets/sounds/card-game-won.ogg"),
  "hearts.gameLost": require("../../../assets/sounds/card-game-lost.ogg"),
};

/** The card place variations, in registry order, for `useSoundVariants` (#3563). */
export const HEARTS_CARD_PLAY = [
  "hearts.cardPlay",
  "hearts.cardPlay2",
  "hearts.cardPlay3",
] as const;

/** The trick-gathered variations, in registry order, for `useSoundVariants` (#3563). */
export const HEARTS_TRICK_WON = [
  "hearts.trickWon",
  "hearts.trickWon2",
  "hearts.trickWon3",
] as const;
