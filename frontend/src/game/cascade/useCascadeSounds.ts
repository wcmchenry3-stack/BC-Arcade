/**
 * Cascade's sound players (#3702): the active piece set's 21 sounds (`CASCADE_SOUNDS`) on the
 * shared one-shot pool (`_shared/soundPool.ts`, one player per file, each holding the audio
 * session), driven by the pacer (`soundPacer.ts`). Frequent sounds get their player at mount;
 * rare ones (`LAZY_CASCADE_SOUNDS`) on their first play, as `useSound`'s `lazy`. A piece-set
 * switch releases the old set's players and takes the new set's. Silent while the game sound is
 * muted (`useSoundSettings`); waiting sounds are dropped on unmount.
 */
import { useEffect, useMemo, useRef } from "react";
import { useSoundSettings } from "../_shared/SoundContext";
import { acquireSound, type SoundHold } from "../_shared/soundPool";
import { CASCADE_SOUNDS, LAZY_CASCADE_SOUNDS, soundSetFor, type CascadeSoundName } from "./sounds";
import { createSoundPacer, type SoundPacer, type SoundPacerDeps } from "./soundPacer";

/** Real time and timers around the screen's `play`. */
function realTime(play: SoundPacerDeps["play"]): SoundPacerDeps {
  return {
    now: () => performance.now(),
    schedule: (run, delayMs) => {
      setTimeout(run, delayMs);
    },
    play,
  };
}

export function useCascadeSounds(setId: string): SoundPacer {
  const { muted } = useSoundSettings();
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const set = soundSetFor(setId);
  // The active set's holds; a lazy sound's appears on its first play. Null once released, so a
  // timer that outlives the set never creates a player nobody would release.
  const holdsRef = useRef<Map<CascadeSoundName, SoundHold> | null>(null);
  const registryRef = useRef(CASCADE_SOUNDS[set]);
  useEffect(() => {
    const registry = CASCADE_SOUNDS[set];
    registryRef.current = registry;
    const holds = new Map<CascadeSoundName, SoundHold>();
    for (const [name, source] of Object.entries(registry) as [CascadeSoundName, number][]) {
      if (!LAZY_CASCADE_SOUNDS.has(name)) holds.set(name, acquireSound(source, 1, false));
    }
    holdsRef.current = holds;
    return () => {
      if (holdsRef.current === holds) holdsRef.current = null;
      for (const hold of holds.values()) hold.release();
      holds.clear();
    };
  }, [set]);

  const pacer = useMemo(
    () =>
      createSoundPacer(
        realTime((name, volume) => {
          const holds = holdsRef.current;
          if (mutedRef.current || !holds) return;
          let hold = holds.get(name);
          if (!hold) {
            const source = registryRef.current[name];
            if (source == null) return;
            hold = acquireSound(source, volume, true);
            holds.set(name, hold);
          }
          hold.play(volume);
        })
      ),
    []
  );
  useEffect(() => () => pacer.reset(), [pacer]);
  return pacer;
}
