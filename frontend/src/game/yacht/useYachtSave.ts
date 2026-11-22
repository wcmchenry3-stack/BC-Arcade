/**
 * The Yacht screen's save (#3749 review round 2): `saveGame` after every change, except that a
 * roll's save waits while its dice tumble (`deferred`), so no JSON or storage write runs between
 * the press and the tumble's first frame.
 *
 * A deferred save is never lost: `flush()` writes it at once, and the screen calls it when the
 * app leaves the foreground; leaving the screen (unmount) flushes it too. Otherwise a roll made
 * just before Back or a swipe-away would reopen on the dice before it: a consumed roll lost, or a
 * bad roll undone. The write is always of the latest state (the rolled dice, the roll counted).
 */
import { useCallback, useEffect, useRef } from "react";

import { saveGame } from "./storage";
import type { AiDifficulty, GameState } from "./types";

export function useYachtSave(
  state: GameState,
  aiDifficulty: AiDifficulty | null,
  aiState: GameState | null,
  finishedGameId: string | null,
  deferred: boolean
): () => void {
  // The latest write still waiting, if any.
  const pending = useRef<(() => void) | null>(null);

  useEffect(() => {
    const write = () => {
      pending.current = null;
      void saveGame(state, aiDifficulty, aiState, finishedGameId);
    };
    if (deferred) pending.current = write;
    else write();
  }, [state, aiDifficulty, aiState, finishedGameId, deferred]);

  const flush = useCallback(() => pending.current?.(), []);
  // Leaving the screen mid-tumble still saves the roll.
  useEffect(() => flush, [flush]);
  return flush;
}
