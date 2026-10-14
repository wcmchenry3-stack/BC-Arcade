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
 * recorder's session follows the game's:
 *  - `start` / `restart` over an open game session end the recorder session
 *    (saving it to the old game) and open a new one. With no game session
 *    open, the recorder session in progress carries on into the new game:
 *    what was recorded before `start()` is saved under the new game id, with
 *    its unit numbers and `t_ms`.
 *  - `resume` saves what is waiting first (the call may close the open game
 *    session), and restarts recording only if a session was resumed; a
 *    failed resume changes nothing.
 *  - `complete` / `close` — and the unmount — end the recorder session,
 *    saving what is still in memory before the session's `game_ended`.
 *  - A new `gameType` (or policy) ends the old recorder's session and uses a
 *    new recorder.
 * See gameRecorder.ts and docs/GAME-CONTRACT.md §2.10.
 */

import { useCallback, useEffect, useMemo } from "react";

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
  /**
   * Record one event in memory. Cheap: call it from gameplay handlers. `data`
   * is taken by ownership — a fresh compact object, never changed afterwards.
   */
  record: (type: string, data?: Record<string, unknown>, actor?: RecordActor) => void;
  /** Close the open unit; under `on_unit_close` it is saved at the next idle moment. */
  closeUnit: () => void;
}

export function useGameRecorder(
  gameType: GameType,
  options: UseGameRecorderOptions = {}
): UseGameRecorderReturn {
  const { policy } = options;
  const recorder = useMemo(() => new GameRecorder({ gameType, policy }), [gameType, policy]);
  // Declared before useGameSync's own effect, so on unmount this cleanup runs
  // first: the recorder saves while the session is still open, ahead of the
  // abandon's game_ended. It also ends a replaced recorder's session.
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
      const replacing = getGameId() !== null;
      if (replacing) recorder.endSession();
      syncStart(eventData, metadata);
      if (replacing || !recorder.inSession) recorder.startSession();
      // Units recorded before the game session opened can be saved now.
      else recorder.requestSave();
    },
    [recorder, getGameId, syncStart]
  );

  const resume = useCallback(
    (match?: Record<string, unknown>): boolean => {
      // A resume that adopts a session closes the open one: save first.
      recorder.flush();
      const resumed = syncResume(match);
      // Recording restarts at the resume: units from 1, t_ms from now. A
      // failed resume keeps the numbering and the clock.
      if (resumed) recorder.startSession();
      return resumed;
    },
    [recorder, syncResume]
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
