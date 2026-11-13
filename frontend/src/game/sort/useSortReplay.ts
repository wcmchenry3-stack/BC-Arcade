/**
 * useSortReplay (#3385, #3386, epic #3383) — the Sort screen's replay
 * recording: a `SortReplay` that records into the screen's
 * `useGameRecorder("sort")` session, and the pure helpers for what the screen
 * sends in `game_started`, saves with a board in progress and does with the
 * replay when it restores one. Where each action is recorded and when the
 * replay is flushed is the screen's (SortScreen.tsx; docs/games/sort.md,
 * "Replay recording").
 */
import { useMemo } from "react";

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
  return useMemo(
    () =>
      new SortReplay({
        isOpen: () => getGameId() !== null,
        beginUnit,
        record: (type, data) => record(type, data),
        closeUnit,
        flush,
        isFull,
      }),
    [getGameId, beginUnit, record, closeUnit, flush, isFull]
  );
}

/**
 * `game_started` for a level's session: the level and the catalog it is from,
 * so a reader rebuilds the opening board from the shipped catalog, and the
 * rules the log is applied with. No board (docs/games/sort.md).
 */
export function sortStartData(level: number | null): Record<string, unknown> {
  return { level, catalog: SORT_CATALOG_VERSION, engine_version: SORT_REPLAY_ENGINE_VERSION };
}

/** `progress` with `levelId`'s board in progress and the replay counts that go with it. Pure. */
export function withBoardInProgress(
  progress: SortProgress,
  levelId: number,
  state: SortState,
  replay: { readonly unit: number; readonly pending: number }
): SortProgress {
  return {
    ...progress,
    currentLevelId: levelId,
    currentState: state,
    replayUnit: replay.unit,
    replayPending: replay.pending,
  };
}

/** `progress` with no level in progress, so no replay counts either. Pure. */
export function withNoBoard(progress: SortProgress): SortProgress {
  const { replayUnit: _unit, replayPending: _pending, ...rest } = progress;
  return { ...rest, currentLevelId: null, currentState: null };
}

/**
 * A saved board was restored and its session `resumed` (or not). A resumed
 * session's `game_started` describes the level's opening board and its stored
 * `moves` lead to the saved board, so the replay carries on from the saved unit
 * count. It stops for good (`block`) instead when the log could not be read
 * through: a save from before replay recording (no count), or one that held
 * actions not yet handed over (a kill lost them, so the stored log has a hole).
 * With no session resumed the replay starts clean; the screen blocks it when
 * the first pour opens a new session on the restored board (`game_started`
 * would describe the level's opening, not this board).
 */
export function restoreReplay(replay: SortReplay, saved: SortProgress, resumed: boolean): void {
  if (!resumed) {
    replay.reset();
    return;
  }
  if (saved.replayUnit === undefined || (saved.replayPending ?? 0) > 0) replay.block();
  else replay.resumeAt(saved.replayUnit);
}
