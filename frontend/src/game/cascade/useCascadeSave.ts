/**
 * Cascade's save and restore (moved out of `CascadeScreen.tsx` in #3701 to keep the screen under
 * 800 lines; the behaviour is unchanged): the board, queue, score and play time are throttle-saved
 * (`storage.ts`, `SAVE_THROTTLE_MS`), restored on mount, and saved whole on a pause.
 */
import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import type { CascadeEngine, PieceSnapshot } from "./engine";
import type { PieceQueue } from "./pieceQueue";
import {
  loadGame as loadCascadeGame,
  saveGame as saveCascadeGame,
  SAVE_VERSION,
  type SavedState,
} from "./storage";

export const SETTLE_TICKS = 60;
const SAVE_THROTTLE_MS = 2000;

export interface CascadeSaveDeps {
  readonly engineRef: MutableRefObject<CascadeEngine | null>;
  readonly piecesRef: MutableRefObject<PieceSnapshot[]>;
  readonly scoreRef: MutableRefObject<number>;
  readonly queueRef: MutableRefObject<PieceQueue>;
  readonly queueHistoryRef: MutableRefObject<number[]>;
  readonly gameOverRef: MutableRefObject<boolean>;
  readonly settlingTicksLeftRef: MutableRefObject<number>;
  readonly playedMs: () => number;
  readonly restartClock: (accumulatedMs: number) => void;
  /** Continues the session a killed app left open (#2654), its replay log where the save left it. */
  readonly resumeSession: (replay?: SavedState["replay"]) => void;
  /** The replay log's place the save carries (#3858). */
  readonly replayState: () => NonNullable<SavedState["replay"]>;
  readonly setScore: (score: number) => void;
  readonly queueChanged: () => void;
  readonly noteTier: (tier: number) => void;
}

export function useCascadeSave(d: CascadeSaveDeps) {
  const { engineRef, piecesRef, scoreRef, queueRef, gameOverRef, playedMs, replayState } = d;
  const { restartClock, resumeSession, setScore, queueChanged, noteTier } = d;
  const lastSaveTimeRef = useRef(0);

  // Load any saved game on mount and restore engine state.
  useEffect(() => {
    let active = true;
    loadCascadeGame().then((snapshot) => {
      if (!active || !snapshot || snapshot.pieces.length === 0) return;
      engineRef.current?.restore(snapshot.pieces, snapshot.score);
      // The play before the app was closed carries on (#2750); the time it was closed doesn't
      // count. A save from an older build has no playedMs: the clock starts at the load.
      restartClock(snapshot.playedMs ?? 0);
      // The restored game continues the session a killed app left open (#2654), in place of
      // the untouched one opened at mount.
      resumeSession(snapshot.replay);
      scoreRef.current = snapshot.score;
      setScore(snapshot.score);
      queueRef.current = snapshot.queue;
      d.queueHistoryRef.current = [snapshot.queue.current, snapshot.queue.next];
      queueChanged();
      d.settlingTicksLeftRef.current = SETTLE_TICKS;
      for (const p of snapshot.pieces) noteTier(p.tier);
    });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeSession, restartClock, setScore, queueChanged, noteTier]);

  const buildSnapshot = useCallback(
    (): SavedState => ({
      version: SAVE_VERSION,
      pieces: piecesRef.current.map((p) => ({ tier: p.tier, x: p.x, y: p.y })),
      score: scoreRef.current,
      savedAt: Date.now(),
      queue: queueRef.current,
      playedMs: playedMs(),
      replay: replayState(),
    }),
    [playedMs, piecesRef, scoreRef, queueRef, replayState]
  );

  /** Once the engine reports the win (#3904) nothing is saved any more. */
  const playOn = useCallback(
    () => !gameOverRef.current && engineRef.current?.hasWon() !== true,
    [gameOverRef, engineRef]
  );

  const saveGameThrottled = useCallback(() => {
    const now = Date.now();
    if (now - lastSaveTimeRef.current < SAVE_THROTTLE_MS) return;
    lastSaveTimeRef.current = now;
    if (!playOn()) return;
    saveCascadeGame(buildSnapshot()).catch(() => {});
  }, [buildSnapshot, playOn]);

  /** The pause save (another screen or the background): the whole board, if there is one. */
  const saveNow = useCallback(() => {
    if (playOn() && piecesRef.current.length > 0) {
      saveCascadeGame(buildSnapshot()).catch(() => {});
    }
  }, [buildSnapshot, playOn, piecesRef]);

  return { saveGameThrottled, saveNow, lastSaveTimeRef };
}
