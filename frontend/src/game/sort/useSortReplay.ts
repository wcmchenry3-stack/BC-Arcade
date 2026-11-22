/**
 * useSortReplay (#3385, #3386, epic #3383) — the Sort screen's replay
 * recording: a `SortReplay` that records into the screen's
 * `useGameRecorder("sort")` session, and the pure helpers for what the screen
 * sends in `game_started`, saves with a board in progress and does with the
 * replay when it restores one. Where each action is recorded and when the
 * replay is flushed is the screen's (SortScreen.tsx; docs/games/sort.md,
 * "Replay recording").
 */
import { useState } from "react";

import type { UseGameRecorderReturn } from "../_shared/useGameRecorder";
import { SORT_CATALOG_VERSION } from "./catalog";
import { SORT_REPLAY_ENGINE_VERSION, SortReplay } from "./replay";
import type { SortProgress } from "./storage";
import type { SortState } from "./types";

type SortRecorder = Pick<
  UseGameRecorderReturn<"sort">,
  "getGameId" | "beginUnit" | "record" | "closeUnit" | "flush" | "isFull"
>;

/** The replay for the screen's recorder session; one per screen. */
export function useSortReplay({
  getGameId,
  beginUnit,
  record,
  closeUnit,
  flush,
  isFull,
}: SortRecorder): SortReplay {
  // One instance for the screen's life: its unit count and pending chunk must
  // never be dropped by a re-render (useMemo makes no such promise). The
  // recorder's callbacks are stable (useCallback in useGameRecorder).
  const [replay] = useState(
    () =>
      new SortReplay({
        isOpen: () => getGameId() !== null,
        beginUnit,
        record: (type, data) => record(type, data),
        closeUnit,
        flush,
        isFull,
      })
  );
  return replay;
}

/**
 * `game_started` for a level's session: the level and the catalog it is from,
 * so a reader rebuilds the opening board from the shipped catalog, and the
 * rules the log is applied with. No board (docs/games/sort.md).
 */
export function sortStartData(level: number | null): Record<string, unknown> {
  return { level, catalog: SORT_CATALOG_VERSION, engine_version: SORT_REPLAY_ENGINE_VERSION };
}

/**
 * `progress` with `levelId`'s board in progress and the replay state that goes
 * with it: the counts and the recorder session (`gameId`, none before the
 * level's first pour). Pure.
 */
export function withBoardInProgress(
  progress: SortProgress,
  levelId: number,
  state: SortState,
  replay: { readonly unit: number; readonly pending: number },
  gameId: string | null
): SortProgress {
  const { replayGameId: _id, ...rest } = progress;
  return {
    ...rest,
    currentLevelId: levelId,
    currentState: state,
    replayUnit: replay.unit,
    replayPending: replay.pending,
    ...(gameId ? { replayGameId: gameId } : {}),
  };
}

/** `progress` with no level in progress, so no replay state either. Pure. */
export function withNoBoard(progress: SortProgress): SortProgress {
  const { replayUnit: _unit, replayPending: _pending, replayGameId: _id, ...rest } = progress;
  return { ...rest, currentLevelId: null, currentState: null };
}

/**
 * A saved board was restored and `resumedGameId` is the session the recorder
 * resumed for it (null: none). The replay carries on from the saved unit count
 * only when that session is the one the board's replay went to
 * (`replayGameId`): a resume adopts any recent killed Sort session, which may
 * be another level's, and carrying this board's moves on in it would read as
 * invalid. It stops for good (`block`) when the session is another one or the
 * save names none (an older build), when the save has no count (from before
 * replay recording), or when it held actions not yet handed over (a kill lost
 * them, so the stored log has a hole). With no session resumed the replay
 * starts clean; the screen blocks it when the first pour opens a new session on
 * the restored board (`game_started` would describe the level's opening, not
 * this board).
 */
export function restoreReplay(
  replay: SortReplay,
  saved: SortProgress,
  resumedGameId: string | null
): void {
  if (resumedGameId === null) {
    replay.reset();
    return;
  }
  if (
    saved.replayGameId !== resumedGameId ||
    saved.replayUnit === undefined ||
    (saved.replayPending ?? 0) > 0
  ) {
    replay.block();
  } else {
    replay.resumeAt(saved.replayUnit);
  }
}
