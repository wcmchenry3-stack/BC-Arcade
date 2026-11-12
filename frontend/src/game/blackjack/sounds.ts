/**
 * Blackjack's sounds (#3563, wired with the card and chip motion in #3581). Each plays at its
 * moment in the motion (docs/games/blackjack.md, "Motion and sound timing"): a card as it is
 * dealt, the hole card as it starts to turn, a chip as it leaves, the result with its banner and
 * the chips ~420 ms after it.
 */
export const BLACKJACK_SOUNDS: Record<string, number> = {
  // card deal: "dealer's toss", three variations, its landing at 240 ms (#3563)
  "blackjack.cardDeal": require("../../../assets/sounds/card-deal-1.ogg"),
  "blackjack.cardDeal2": require("../../../assets/sounds/card-deal-2.ogg"),
  "blackjack.cardDeal3": require("../../../assets/sounds/card-deal-3.ogg"),
  // the hole card's flip: the shared card flip (#3563)
  "blackjack.cardFlip": require("../../../assets/sounds/card-flip-1.ogg"),
  "blackjack.cardFlip2": require("../../../assets/sounds/card-flip-2.ogg"),
  "blackjack.cardFlip3": require("../../../assets/sounds/card-flip-3.ogg"),
  // chips, "felt thud" (#3563)
  "blackjack.chipBet": require("../../../assets/sounds/chip-bet-1.ogg"),
  "blackjack.chipBet2": require("../../../assets/sounds/chip-bet-2.ogg"),
  "blackjack.chipBet3": require("../../../assets/sounds/chip-bet-3.ogg"),
  "blackjack.chipPayout": require("../../../assets/sounds/chip-payout.ogg"),
  "blackjack.chipCollect": require("../../../assets/sounds/chip-collect.ogg"),
  "blackjack.chipNudge": require("../../../assets/sounds/chip-nudge.ogg"),
  // results, "soft chimes" (#3563)
  "blackjack.win": require("../../../assets/sounds/result-win.ogg"),
  "blackjack.lose": require("../../../assets/sounds/result-lose.ogg"),
  "blackjack.bust": require("../../../assets/sounds/result-bust.ogg"),
  "blackjack.push": require("../../../assets/sounds/result-push.ogg"),
  "blackjack.blackjack": require("../../../assets/sounds/result-blackjack.ogg"),
};

/** The card deal variations, for `useSoundVariants`. */
export const BLACKJACK_CARD_DEAL = [
  "blackjack.cardDeal",
  "blackjack.cardDeal2",
  "blackjack.cardDeal3",
] as const;

/** The card flip variations (the hole card), for `useSoundVariants`. */
export const BLACKJACK_CARD_FLIP = [
  "blackjack.cardFlip",
  "blackjack.cardFlip2",
  "blackjack.cardFlip3",
] as const;

/** The chip bet variations (a chip into the circle, a split's second stake). */
export const BLACKJACK_CHIP_BET = [
  "blackjack.chipBet",
  "blackjack.chipBet2",
  "blackjack.chipBet3",
] as const;
