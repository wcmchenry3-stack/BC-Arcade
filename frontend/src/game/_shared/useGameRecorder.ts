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
 *    session). A failed resume changes nothing. A successful one restarts
 *    recording when it replaced an open game session; with none open, units
 *    recorded before it are kept and saved under the resumed game. The
 *    recorder cannot know the units the game saved before the app was killed,
 *    so its default numbering (from 1) would repeat them: a game that resumes
 *    passes its own unit number to `beginUnit(n)` (from its restored state).
 *  - `complete` / `close` — and the unmount — end the recorder session,
 *    saving what is still in memory before the session's `game_ended`.
 *    `complete` also puts the recorder's counts (`stats()`) in the payload's
 *    `replay` field, for the `game_ended` replay summary (#3279).
 *  - A new `gameType` (or policy) ends the old recorder's session and uses a
 *    new recorder. While the same game session stays open, the old one's
 *    events are saved to it and the new recorder carries the clock, unit
 *    numbering and session-cap usage on. With no game open, what the old
 *    recorder held is dropped (reported as `dropped_unsent`) and the new one
 *    starts fresh.
 *  - After `complete` / `close`, `record()` does nothing until the next
 *    `start` / `resume`: what is recorded between games belongs to no game.
 * See gameRecorder.ts and docs/GAME-CONTRACT.md §2.10.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";

import {
  GameRecorder,
  type RecordActor,
  type RecorderHandoff,
  type SendPolicy,
} from "./gameRecorder";
import type { EventTypeOf } from "./eventQueueConfig";
import { gameEventClient } from "./gameEventClient";
import type { CompleteSummary } from "./pendingGamesStore";
import { captureThrottledMessage } from "./sentryThrottle";
import { isRecordingEnabled } from "./replayDial";
import { useGameSync, type UseGameSyncReturn } from "./useGameSync";
import type { GameType } from "./types";

export interface UseGameRecorderOptions {
  /** Defaults to `on_unit_close`. */
  readonly policy?: SendPolicy;
}

export interface UseGameRecorderReturn<G extends GameType = GameType> extends UseGameSyncReturn<G> {
  /** Begin a unit (round / hand / trick / chunk); `n` defaults to the last one's plus one. */
  beginUnit: (n?: number) => number;
  /**
   * Record one event in memory. Cheap: call it from gameplay handlers. `data`
   * is taken by ownership — a fresh compact object, never changed afterwards.
   */
  record: (type: EventTypeOf<G>, data?: Record<string, unknown>, actor?: RecordActor) => void;
  /** Close the open unit; under `on_unit_close` it is saved at the next idle moment. */
  closeUnit: () => void;
  /**
   * Hand everything waiting to the queue now, synchronously, without ending the
   * session (numbering, `t_ms` and the open unit carry on). For the moment the
   * app leaves the foreground: an idle save may never run before a kill. The
   * queue's own AsyncStorage write is still asynchronous.
   */
  flush: () => void;
  /**
   * Whether the recorder is recording this session (its own decision, not a
   * fresh read of the dial). Gate work done only for the replay on this.
   */
  isRecording: () => boolean;
  /** Whether the session reached its byte cap, so it stores nothing more (#3285). */
  isFull: () => boolean;
}

/**
 * Whether a recorder session for the game session `gameId` records (#3279):
 * not when its stored replay mode is `off`. With no game session (or one the
 * client does not know), the dial decides, as it will for the next start.
 */
function sessionRecords(gameId: string | null, gameType: GameType): boolean {
  try {
    const mode = gameId === null ? null : gameEventClient.replayMode(gameId);
    return mode === null ? isRecordingEnabled(gameType) : mode !== "off";
  } catch {
    return isRecordingEnabled(gameType); // isolation: never break the game
  }
}

export function useGameRecorder<G extends GameType>(
  gameType: G,
  options: UseGameRecorderOptions = {}
): UseGameRecorderReturn<G> {
  const { policy } = options;
  const recorder = useMemo(() => new GameRecorder<G>({ gameType, policy }), [gameType, policy]);
  // Declared before useGameSync's own effect, so on unmount this cleanup runs
  // first: the recorder saves while the session is still open, ahead of the
  // abandon's game_ended. It also ends a replaced recorder's session, after
  // noting where it stood for the recorder that replaces it.
  const handoffRef = useRef<RecorderHandoff | null>(null);
  useEffect(() => {
    // StrictMode runs this cleanup and setup once more on mount: re-arm, so
    // the remount records like a fresh mount.
    recorder.rearm();
    return () => {
      // Taken after the pending events are measured and saved, so the
      // replacing recorder's cap usage includes them.
      handoffRef.current = recorder.endSession();
    };
  }, [recorder]);

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
    recorder.setSink({
      canAccept: () => getGameId() !== null,
      enqueueMany,
      // Whether the recorder records is the open game session's stored replay
      // mode (#3279: decided once at its start, so a dial read now cannot
      // disagree with it); with no game session open yet, the dial.
      records: () => sessionRecords(getGameId(), gameType),
    });
  }, [recorder, getGameId, enqueueMany, gameType]);
  // A recorder that replaced another (a new gameType) while the same game
  // session is open carries its clock and unit numbering on.
  useEffect(() => {
    const handoff = handoffRef.current;
    handoffRef.current = null;
    if (handoff && getGameId() !== null && !recorder.inSession) recorder.continueFrom(handoff);
  }, [recorder, getGameId]);

  const start = useCallback(
    (eventData?: Record<string, unknown>, metadata?: Record<string, unknown>) => {
      const replacing = getGameId() !== null;
      if (replacing) recorder.endSession();
      syncStart(eventData, metadata);
      if (replacing || !recorder.inSession) recorder.startSession();
      else {
        // Units recorded before the game session opened can be saved now, if
        // the new game records at all.
        recorder.refreshEnabled();
        recorder.requestSave();
      }
    },
    [recorder, getGameId, syncStart]
  );

  const resume = useCallback(
    (match?: Record<string, unknown>): boolean => {
      // A resume that adopts a session closes the open one: save first.
      const replacing = getGameId() !== null;
      // Isolation: a recorder that throws must not keep the game from resuming.
      try {
        recorder.flush();
      } catch (error) {
        captureThrottledMessage("useGameRecorder.flush.failed", "useGameRecorder flush failed", {
          level: "warning",
          tags: { subsystem: "gameRecorder", game_type: gameType },
          extra: { error: error instanceof Error ? error.name : typeof error },
        });
      }
      const resumed = syncResume(match);
      // A failed resume keeps the numbering and the clock. A successful one
      // over an open game session restarts recording (t_ms from now); with no
      // game session open, the recorder session in progress carries on and
      // its waiting units are saved under the resumed game, as `start` does.
      if (resumed) {
        if (replacing || !recorder.inSession) recorder.startSession();
        else {
          recorder.refreshEnabled();
          recorder.requestSave();
        }
      }
      return resumed;
    },
    [recorder, getGameId, syncResume, gameType]
  );

  const complete = useCallback(
    (summary: CompleteSummary, payload?: Record<string, unknown>): string | null => {
      recorder.endSession();
      // The session's counts ride in game_ended's replay summary (#3279);
      // gameEventClient adds the sampling mode to them.
      const stats = recorder.stats();
      return syncComplete(summary, stats ? { ...payload, replay: stats } : payload);
    },
    [recorder, syncComplete]
  );

  const close = useCallback(() => {
    recorder.endSession();
    syncClose();
  }, [recorder, syncClose]);

  const beginUnit = useCallback((n?: number) => recorder.beginUnit(n), [recorder]);
  const record = useCallback(
    (type: EventTypeOf<G>, data?: Record<string, unknown>, actor?: RecordActor) =>
      recorder.record(type, data, actor),
    [recorder]
  );
  const closeUnit = useCallback(() => recorder.closeUnit(), [recorder]);
  const flush = useCallback(() => recorder.flush(), [recorder]);
  const isRecording = useCallback(() => recorder.recording, [recorder]);
  const isFull = useCallback(() => recorder.full, [recorder]);

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
    flush,
    isRecording,
    isFull,
  };
}
