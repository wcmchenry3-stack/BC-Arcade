import { useCallback, useEffect, useRef } from "react";
import { useSoundSettings } from "./SoundContext";
import { acquireSound, PENDING_PLAY_TIMEOUT_MS, type SoundHold } from "./soundPool";

/**
 * Re-exported for the existing useSound tests (the constant moved to soundPool.ts).
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export { PENDING_PLAY_TIMEOUT_MS };

/** How a sound's player is created (#3604). */
export interface SoundOptions {
  /**
   * Create the player on the first `play()` instead of at mount. Default `false` (eager): the
   * player exists, loaded, before the first `play()`, so that play has no creation latency.
   *
   * Mark a key `lazy` when it is rare (once per game or less: a win jingle, a Draw-3 fan, a
   * riffle) and its first play may take a few ms longer. Leave frequent, latency-sensitive
   * sounds (card place, laser) eager. A lazy player that is never played is never created and
   * never retains the audio session; it is removed on unmount like any other.
   */
  lazy?: boolean;
}

/** Shorthand for rarely played sounds: `useSound(key, registry, 1.0, LAZY_SOUND)`. */
export const LAZY_SOUND: SoundOptions = { lazy: true };

/**
 * One sound. The player is shared per distinct asset (see soundPool.ts) and, by default, created
 * at mount; `options.lazy` creates it on the first `play()` instead (see SoundOptions).
 */
export function useSound(
  key: string,
  registry: Record<string, number>,
  volume = 1.0,
  { lazy = false }: SoundOptions = {}
): { play: () => boolean; stop: () => void } {
  const { muted } = useSoundSettings();
  const mutedRef = useRef(muted);
  const volumeRef = useRef(volume);
  // True between the effect's setup and its cleanup. A stale `play` (a timer that outlived the
  // screen) must not create a lazy player nobody would ever release.
  const aliveRef = useRef(false);
  // The asset this key plays (null: unregistered) and the hold on its shared player (null: not
  // created yet, for a lazy sound).
  const sourceRef = useRef<number | null>(null);
  const holdRef = useRef<SoundHold | null>(null);

  // Keep refs in sync so the stable `play` callback sees the latest values.
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const source = registry[key] ?? null;
    sourceRef.current = source;
    aliveRef.current = true;
    if (!lazy && source != null) holdRef.current = acquireSound(source, volumeRef.current, false);
    return () => {
      aliveRef.current = false;
      holdRef.current?.release();
      holdRef.current = null;
      sourceRef.current = null;
    };
  }, [key, registry, lazy]);

  // Sync volume changes to the live player without recreating it.
  useEffect(() => {
    volumeRef.current = volume;
    holdRef.current?.setVolume(volume);
  }, [volume]);

  // Returns whether playback was actually started — false when muted, when the sound has no
  // player, or when the call was dropped by the in-flight guard. Most callers ignore it; a
  // caller that syncs something to the sound's length (Star Swarm's PERFECT hold) needs it.
  const play = useCallback((): boolean => {
    if (mutedRef.current || !aliveRef.current) return false;
    let hold = holdRef.current;
    if (!hold) {
      const source = sourceRef.current;
      if (source == null) return false;
      // A lazy sound's first play: create the player now. Synchronous, so a rapid second call
      // finds the hold already in place and can never create a second player.
      hold = acquireSound(source, volumeRef.current, true);
      holdRef.current = hold;
    }
    return hold.play(volumeRef.current);
  }, []);

  // Cuts the sound off and rewinds it — for a long sound (a fanfare) that must not carry on
  // over whatever the player does next. A lazy sound that was never played has nothing to stop.
  const stop = useCallback(() => {
    holdRef.current?.stop();
  }, []);

  return { play, stop };
}
