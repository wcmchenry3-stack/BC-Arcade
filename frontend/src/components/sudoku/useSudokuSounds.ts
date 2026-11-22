/**
 * useSudokuSounds (#3775): one sound per move, from the engine's events.
 *
 * - A move's events arrive as one array (`digitPlace`, then `errorEntered`, or the units it
 *   completes, then `puzzleComplete`). The sound is the most notable of them: the solve over an
 *   error over a completed unit over the plain place tick. A unit's sound and the win both open
 *   with the place tick, so a move never plays two sounds.
 * - A hint places a digit, so it plays like one. Notes, Erase, Undo and the Hint button itself make
 *   no sound: they emit no events, or none new.
 * - The win starts at the solving render and its chord lands as the card shows (`SOLVED_BEAT_MS`).
 *   A restored game carries no events, so it is silent, as is a remount.
 * - `stopPuzzleComplete` cuts the win off (New Game, Play Again, Change Difficulty) and so does an
 *   unmount: the old fanfare ran on into the next puzzle.
 *
 * The sounds follow the player's sound setting through `useSound`.
 */
import { useEffect, useRef } from "react";

import type { GameEvent } from "../../game/sudoku/types";
import { SUDOKU_DIGIT_PLACE, SUDOKU_SOUNDS, soundForEvents } from "../../game/sudoku/sounds";
import { useSound } from "../../game/_shared/useSound";
import { useSoundVariants } from "../../game/_shared/useSoundVariants";

export function useSudokuSounds(events: readonly GameEvent[] | undefined): {
  stopPuzzleComplete: () => void;
} {
  const { play: playPlace } = useSoundVariants(SUDOKU_DIGIT_PLACE, SUDOKU_SOUNDS);
  const { play: playError } = useSound("sudoku.errorEntered", SUDOKU_SOUNDS);
  const { play: playUnit } = useSound("sudoku.unitComplete", SUDOKU_SOUNDS);
  const { play: playWin, stop: stopWin } = useSound("sudoku.puzzleComplete", SUDOKU_SOUNDS);

  // Each engine action makes a new events array (a pause or a selection keeps it): play once per
  // array. The first render's undefined, and a restored game's, play nothing.
  const lastRef = useRef<readonly GameEvent[] | undefined>(undefined);
  useEffect(() => {
    if (events === lastRef.current) return;
    lastRef.current = events;
    switch (soundForEvents(events)) {
      case "sudoku.puzzleComplete":
        playWin();
        break;
      case "sudoku.errorEntered":
        playError();
        break;
      case "sudoku.unitComplete":
        playUnit();
        break;
      case "sudoku.digitPlace":
        playPlace();
        break;
    }
  }, [events, playPlace, playError, playUnit, playWin]);

  // Unmounting cuts the win off (useSound also pauses its player when it is removed).
  const stopRef = useRef(stopWin);
  useEffect(() => {
    stopRef.current = stopWin;
  }, [stopWin]);
  useEffect(() => () => stopRef.current(), []);

  return { stopPuzzleComplete: stopWin };
}
