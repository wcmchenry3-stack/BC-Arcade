/**
 * Daily Word palette — the Wordle-style tile and key colours.
 *
 * `WordTile` (board) and `WordKeyboard` (keys) share one definition, so a
 * letter's colour on the board always matches its key. These are fixed in both
 * light and dark mode: the green / yellow / grey meaning is the game itself,
 * and the white label reads on all three.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/** Right letter, right place. */
export const DAILYWORD_CORRECT = "#538d4e";

/** Right letter, wrong place. Dark amber so the white label clears WCAG AA (4.69:1, #3101). */
export const DAILYWORD_PRESENT = "#8c7100";

/** Letter not in the word. */
export const DAILYWORD_ABSENT = "#3a3a3c";

/** Letter on a scored tile or key. */
export const DAILYWORD_LETTER_TEXT = "#ffffff";
