/**
 * After the win (#3920): how long the screen keeps stepping and drawing the board.
 *
 * Making the capstone ends play, but the capstone is made at its parents' size and grows in over
 * `GROW_IN_STEPS` fixed steps (about 0.27 s). If the screen stopped its loop on the `win` event,
 * the Pumpkin / Milky Way would stay drawn at about 0.8 of its size, overlapping its neighbours,
 * until Restart. So the loop runs on until no piece is still growing in, plus `WIN_SETTLE_MS` of
 * frame time for the neighbours to settle, and then stops. Nothing else changes after the win:
 * the engine blocks drops, the session is already complete and nothing is saved.
 *
 * It always ends: besides the grow-in rule, it stops after `WIN_TAIL_MAX_FRAMES` frames, and the
 * time only counts frames the loop actually ran (a trip to the background pauses it, and the
 * resume carries on the same tail; it never starts a new one).
 */

/** Frame time (ms) the loop keeps running once no piece is growing in. */
export const WIN_SETTLE_MS = 100;
/** A hard cap on frames after the win: 2 s at 120 Hz. */
export const WIN_TAIL_MAX_FRAMES = 240;

export interface WinTail {
  /**
   * Called once per frame after the win, with that frame's delta and the board it drew. True
   * while the loop should schedule another frame.
   */
  advance(deltaMs: number, pieces: readonly { scale?: number }[]): boolean;
  /** True once the tail has ended: the loop must not run again (resume included). */
  readonly done: boolean;
}

export function createWinTail(): WinTail {
  let settleLeft = WIN_SETTLE_MS;
  let frames = 0;
  let done = false;
  return {
    get done() {
      return done;
    },
    advance(deltaMs, pieces) {
      if (done) return false;
      frames++;
      const growing = pieces.some((p) => (p.scale ?? 1) < 1);
      if (!growing) settleLeft -= deltaMs;
      done = settleLeft <= 0 || frames >= WIN_TAIL_MAX_FRAMES;
      return !done;
    },
  };
}

/** The screen's loop rule: whether to schedule another frame, and whether a resume may run. */
export interface LoopGate {
  /** After a frame: true to schedule the next one. */
  afterFrame(deltaMs: number, pieces: readonly { scale?: number }[]): boolean;
  /** Whether the loop may run at all (a resume asks first). */
  runs(): boolean;
}

/**
 * Before the win the loop runs until game over; after it, until its win tail ends. A won game
 * also reports game over to the screen (`handleGameOver(true)`), so the win is checked first.
 */
export function createLoopGate(engine: { hasWon(): boolean }, gameOver: () => boolean): LoopGate {
  const tail = createWinTail();
  return {
    afterFrame: (deltaMs, pieces) =>
      engine.hasWon() ? tail.advance(deltaMs, pieces) : !gameOver(),
    runs: () => (engine.hasWon() ? !tail.done : !gameOver()),
  };
}
