/**
 * useGameRecorder — `useGameSync` plus the shared gameplay recorder (#3274).
 *
 *   const sync = useGameRecorder("hearts");               // on_unit_close
 *   const sync = useGameRecorder("starswarm", { policy: "on_session_end" });
 *   sync.start(eventData, metadata);
 *   sync.beginUnit(handNumber);
 *   sync.record("card_played", { c: "QS" }, { seat: 2, kind: "cpu", cpu_type: "shark" });
 *   sync.closeUnit();
 *   sync.complete(summary, payload);
 *
 * Everything `useGameSync` returns, with its session calls wrapped so the
 * recorder's session follows the game's: `start` / `restart` / `resume` open a
 * recorder session (ending the previous one first), and `complete` / `close`
 * — and the unmount — end it, saving what is still in memory before the
 * session's `game_ended`. See gameRecorder.ts and docs/GAME-CONTRACT.md §2.10.
 */

import { useCallback, useEffect, useState } from "react";

import { GameRecorder, type RecordActor, type SendPolicy } from "./gameRecorder";
import type { CompleteSummary } from "./pendingGamesStore";
import { useGameSync, type UseGameSyncReturn } from "./useGameSync";
import type { GameType } from "./types";

export interface UseGameRecorderOptions {
  /** Defaults to `on_unit_close`. */
  readonly policy?: SendPolicy;
}

export interface UseGameRecorderReturn extends UseGameSyncReturn {
  /** Begin a unit (round / hand / trick / chunk); `n` defaults to the last one's plus one. */
  beginUnit: (n?: number) => number;
  /** Record one event in memory. Cheap: call it from gameplay handlers. */
  record: (type: string, data?: Record<string, unknown>, actor?: RecordActor) => void;
  /** Close the open unit; under `on_unit_close` it is saved at the next idle moment. */
  closeUnit: () => void;
}

export function useGameRecorder(
  gameType: GameType,
  options: UseGameRecorderOptions = {}
): UseGameRecorderReturn {
  const [recorder] = useState(() => new GameRecorder({ gameType, policy: options.policy }));
  // Declared before useGameSync's own effect, so on unmount this cleanup runs
  // first: the recorder saves while the session is still open, ahead of the
  // abandon's game_ended.
  useEffect(() => () => recorder.endSession(), [recorder]);

  const sync = useGameSync(gameType);
  const {
    enqueueMany,
    getGameId,
    start: syncStart,
    resume: syncResume,
    complete: syncComplete,
    close: syncClose,
  } = sync;
  useEffect(() => {
    recorder.setSink(enqueueMany);
  }, [recorder, enqueueMany]);

  const start = useCallback(
    (eventData?: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      recorder.endSession();
      syncStart(eventData, metadata);
      recorder.startSession();
    },
    [recorder, syncStart]
  );

  const resume = useCallback(
    (match?: Record<string, unknown>): boolean => {
      // A resume that adopts a session closes the open one: save it first.
      if (getGameId() !== null) recorder.endSession();
      const resumed = syncResume(match);
      // Recording restarts at the resume: units from 1, t_ms from now.
      if (resumed) recorder.startSession();
      return resumed;
    },
    [recorder, getGameId, syncResume]
  );

  const complete = useCallback(
    (summary: CompleteSummary, payload?: Record<string, unknown>): string | null => {
      recorder.endSession();
      return syncComplete(summary, payload);
    },
    [recorder, syncComplete]
  );

  const close = useCallback(() => {
    recorder.endSession();
    syncClose();
  }, [recorder, syncClose]);

  const beginUnit = useCallback((n?: number) => recorder.beginUnit(n), [recorder]);
  const record = useCallback(
    (type: string, data?: Record<string, unknown>, actor?: RecordActor) =>
      recorder.record(type, data, actor),
    [recorder]
  );
  const closeUnit = useCallback(() => recorder.closeUnit(), [recorder]);

  return {
    ...sync,
    start,
    restart: start,
    resume,
    complete,
    close,
    beginUnit,
    record,
    closeUnit,
  };
}
