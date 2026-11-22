import type React from "react";
import { useEffect, useRef } from "react";
import { useLoopSound } from "./useLoopSound";
import { LAZY_SOUND, useSound } from "./useSound";

/** The three parts of a sound that lasts as long as a run, e.g. Auto-Complete's riffle (#3563). */
export interface RunSoundKeys {
  /** One-shot as the run begins, played with the loop's start so it covers the loop's entry. */
  readonly start: string;
  /** Loops for as long as the run lasts. */
  readonly loop: string;
  /** One-shot when the run ends with its job done (the board is solved). */
  readonly settle: string;
}

/**
 * A start → loop → settle sound driven by one flag (#3563). When `active` turns true the start
 * plays and the loop begins; when it turns false the loop stops, and the settle plays only if
 * `finished` (a run cut short, e.g. a new deal, just goes quiet). Mute and unmount are handled by
 * `useSound` / `useLoopSound`.
 */
export function useRunSound(
  active: boolean,
  finished: boolean,
  keys: RunSoundKeys,
  registry: Record<string, number>
): void {
  // A run sound plays at most a few times per game, so all three parts are created on first use
  // (#3604) rather than as three extra players at mount.
  const { play: playStart } = useSound(keys.start, registry, 1.0, LAZY_SOUND);
  const { play: playSettle } = useSound(keys.settle, registry, 1.0, LAZY_SOUND);
  const { start: startLoop, stop: stopLoop } = useLoopSound(keys.loop, registry, 1.0, LAZY_SOUND);
  const wasActiveRef = useRef(false);

  useEffect(() => {
    const wasActive = wasActiveRef.current;
    wasActiveRef.current = active;
    if (active && !wasActive) {
      playStart();
      startLoop();
    } else if (!active && wasActive) {
      stopLoop();
      if (finished) playSettle();
    }
  }, [active, finished, playStart, playSettle, startLoop, stopLoop]);
}

/**
 * Auto-Complete's riffle for a card game (#3563): plays the run sound while `autoCompleting`, and
 * returns a ref the screen sets to `true` when its run moves its first card. While it is set,
 * per-card sounds (card place, stock flips) stay quiet, the last card included, since the
 * settle replaces it. It clears itself once the run ends without finishing the game, or a new
 * game starts.
 *
 * `paused` (the game's clock paused while another screen covers it or the app is in the
 * background): the run's steps wait, so the riffle goes quiet too (the loop stops, no settle),
 * and starts again on return. The run flag is untouched, so the run stays muted throughout.
 */
export function useAutoCompleteRiffle(
  autoCompleting: boolean,
  game: { readonly isComplete: boolean } | null,
  keys: RunSoundKeys,
  registry: Record<string, number>,
  paused = false
): React.MutableRefObject<boolean> {
  const runRef = useRef(false);
  const finished = game !== null && game.isComplete;
  useRunSound(autoCompleting && !paused, finished, keys, registry);
  useEffect(() => {
    if (!autoCompleting && !finished) runRef.current = false;
  }, [autoCompleting, finished]);
  return runRef;
}
