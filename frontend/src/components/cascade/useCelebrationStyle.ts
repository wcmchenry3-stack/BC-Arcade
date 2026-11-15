/**
 * #3699: the board's win-celebration style, made before it is needed, and a signal when it is.
 *
 * Building it (the capstone rasterised four times at 1.4x, `art/sprites.ts`, plus paths and
 * gradients, `render/celebrationStyle.ts`) takes JS-thread time. Done in the win's render, it
 * held the board on the plain capstone while the UI-thread clock ran on, so the celebration
 * appeared finished, its dim and rise never seen (iOS demo on #3924). So:
 *
 * - **Pre-warm.** Once the board holds a tier-9 piece (`prepare`: one merge from the win), the
 *   style is built in idle time (`requestIdleCallback`, with a deadline), never on the frame or
 *   gesture path. Games that never get near a win pay nothing.
 * - **On demand.** A win before the pre-warm has run builds it at once, after the win's commit.
 * - **Ready.** `onReady` fires once the game is won and the style is there (or known to fail:
 *   no Skia), and the screen starts the celebration's clock then, so the card follows about 2.1 s
 *   after the celebration can actually be seen. `GameResultModal`'s 4 s safety net still shows
 *   the card if it never does.
 *
 * Styles are cached by set, theme and pixel scale (`celebrationStyleFor`); Reduce Motion is laid
 * over the cached style here, so switching it costs no rebuild.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { areTestHooksEnabled } from "../../game/_shared/envFlags";
import type { PieceSprite } from "../../game/cascade/art/sprites";
import type { CelebrationStyle } from "../../game/cascade/render/drawCelebration";
import {
  celebrationStyleFor,
  celebrationStyleKey,
  lastCelebrationBuildMs,
} from "../../game/cascade/render/celebrationStyle";

/** The pre-warm waits at most this long for idle time before it runs anyway. */
export const PREWARM_IDLE_TIMEOUT_MS = 1500;

/** Runs `task` when the JS thread is idle (or after the deadline); returns a cancel. */
function scheduleIdle(task: () => void): () => void {
  const g = globalThis as {
    requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number;
    cancelIdleCallback?: (id: number) => void;
  };
  if (typeof g.requestIdleCallback === "function") {
    const id = g.requestIdleCallback(task, { timeout: PREWARM_IDLE_TIMEOUT_MS });
    return () => g.cancelIdleCallback?.(id);
  }
  const id = setTimeout(task, 0);
  return () => clearTimeout(id);
}

export interface UseCelebrationStyleArgs {
  readonly setId: string;
  readonly theme: "light" | "dark";
  readonly pxPerUnit: number;
  /** The board's own capstone bitmaps: drawn if the bigger raster cannot be made. */
  readonly fallback: PieceSprite | null;
  /** The board holds a tier-9 piece: build ahead, in idle time. */
  readonly prepare: boolean;
  readonly won: boolean;
  readonly reduceMotion: boolean;
  /** The game is won and the style is ready (or cannot be made): start the celebration. */
  readonly onReady?: () => void;
}

/** The style to draw the celebration with: null until the game is won and it is ready. */
export function useCelebrationStyle({
  setId,
  theme,
  pxPerUnit,
  fallback,
  prepare,
  won,
  reduceMotion,
  onReady,
}: UseCelebrationStyleArgs): CelebrationStyle | null {
  const key = celebrationStyleKey({ setId, theme, pxPerUnit });
  const [built, setBuilt] = useState<{ key: string; style: CelebrationStyle | null } | null>(null);
  const have = built !== null && built.key === key;

  useEffect(() => {
    if (have || !(prepare || won)) return;
    const build = (when: string) => {
      const style = celebrationStyleFor({ setId, theme, pxPerUnit }, fallback);
      if (__DEV__ || areTestHooksEnabled()) {
        console.log(
          `[Cascade] celebration style ready (${when}): built in ${lastCelebrationBuildMs()} ms`
        );
      }
      setBuilt({ key, style });
    };
    // Won before the pre-warm ran: build now (after the win's commit, not inside its render).
    if (won) {
      build("on demand");
      return;
    }
    return scheduleIdle(() => build("pre-warm"));
  }, [have, prepare, won, key, setId, theme, pxPerUnit, fallback]);

  const ready = won && have;
  const onReadyRef = useRef(onReady);
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);
  useEffect(() => {
    if (ready) onReadyRef.current?.();
  }, [ready]);

  const base = have && won ? built.style : null;
  return useMemo(() => (base ? { ...base, reduceMotion } : null), [base, reduceMotion]);
}
