export const DAILY_WORD_SOUNDS: Record<string, number> = {
  // shared win fanfare, also used by hearts.moonShot, sudoku.puzzleComplete and others (#2926)
  "dailyWord.win": require("../../../assets/sounds/hearts-moon-shot.mp3"),
  // tile reveal, "wooden letter tiles": one per tile as its colour shows (motion.ts), by result,
  // three variations each, played by useSoundVariants (#3665)
  "dailyWord.revealMiss": require("../../../assets/sounds/daily-word-miss-1.ogg"),
  "dailyWord.revealMiss2": require("../../../assets/sounds/daily-word-miss-2.ogg"),
  "dailyWord.revealMiss3": require("../../../assets/sounds/daily-word-miss-3.ogg"),
  "dailyWord.revealPresent": require("../../../assets/sounds/daily-word-present-1.ogg"),
  "dailyWord.revealPresent2": require("../../../assets/sounds/daily-word-present-2.ogg"),
  "dailyWord.revealPresent3": require("../../../assets/sounds/daily-word-present-3.ogg"),
  "dailyWord.revealCorrect": require("../../../assets/sounds/daily-word-correct-1.ogg"),
  "dailyWord.revealCorrect2": require("../../../assets/sounds/daily-word-correct-2.ogg"),
  "dailyWord.revealCorrect3": require("../../../assets/sounds/daily-word-correct-3.ogg"),
  // a refused guess: a soft wooden "no" with the row's shake (#3665)
  "dailyWord.refused": require("../../../assets/sounds/daily-word-refused.ogg"),
};

/** A grey (absent) tile's reveal variations, in registry order, for `useSoundVariants` (#3665). */
export const DAILY_WORD_REVEAL_MISS = [
  "dailyWord.revealMiss",
  "dailyWord.revealMiss2",
  "dailyWord.revealMiss3",
] as const;

/** A yellow (present) tile's reveal variations, for `useSoundVariants` (#3665). */
export const DAILY_WORD_REVEAL_PRESENT = [
  "dailyWord.revealPresent",
  "dailyWord.revealPresent2",
  "dailyWord.revealPresent3",
] as const;

/** A green (correct) tile's reveal variations, for `useSoundVariants` (#3665). */
export const DAILY_WORD_REVEAL_CORRECT = [
  "dailyWord.revealCorrect",
  "dailyWord.revealCorrect2",
  "dailyWord.revealCorrect3",
] as const;
