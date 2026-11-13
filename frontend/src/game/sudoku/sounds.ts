import type { GameEvent } from "./types";

export const SUDOKU_SOUNDS: Record<string, number> = {
  // digit place, "crisp graphite": three pencil-tick variations played by useSoundVariants (#3775)
  "sudoku.digitPlace": require("../../../assets/sounds/sudoku-digit-place.ogg"),
  "sudoku.digitPlace2": require("../../../assets/sounds/sudoku-digit-place-2.ogg"),
  "sudoku.digitPlace3": require("../../../assets/sounds/sudoku-digit-place-3.ogg"),
  // an illegal digit: a pencil scratch-out, Sudoku's own (it no longer borrows the card games')
  "sudoku.errorEntered": require("../../../assets/sounds/sudoku-error-entered.ogg"),
  // a completed row, column or box: pencil taps along the sweep; it opens with the place tick
  "sudoku.unitComplete": require("../../../assets/sounds/sudoku-unit-complete.ogg"),
  // solved: underline, check tick, then a felt-piano chord as the card shows (+1.0 s)
  "sudoku.puzzleComplete": require("../../../assets/sounds/sudoku-puzzle-complete.ogg"),
};

/** The digit place variations, in registry order, for `useSoundVariants` (#3775). */
export const SUDOKU_DIGIT_PLACE = [
  "sudoku.digitPlace",
  "sudoku.digitPlace2",
  "sudoku.digitPlace3",
] as const;

/** The one sound a move plays, by registry key; null for no events. */
export function soundForEvents(events: readonly GameEvent[] | undefined): string | null {
  if (!events || events.length === 0) return null;
  const has = (type: GameEvent["type"]) => events.some((e) => e.type === type);
  if (has("puzzleComplete")) return "sudoku.puzzleComplete";
  if (has("errorEntered")) return "sudoku.errorEntered";
  if (has("unitComplete")) return "sudoku.unitComplete";
  if (has("digitPlace")) return "sudoku.digitPlace";
  return null;
}
