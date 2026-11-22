/**
 * Cascade's sound players (#3702): the active piece set's 22 sounds (`CASCADE_SOUNDS`) on the
 * shared one-shot pool (`_shared/soundPool.ts`, one player per file, each holding the audio
 * session), driven by the pacer (`soundPacer.ts`). The frequent sounds get their player at mount
 * (8, see `LAZY_CASCADE_SOUNDS`); the rest on their first play, or ahead of it when they become
 * likely: the win and the capstone's merge-t11 once a tier-10 piece (one below the capstone) is on
 * the board (`nearWin`, the celebration's pre-warm trigger), danger and game over when the lid count first runs. A piece-set switch releases the
 * old set's players and takes the new set's. Silent while the game sound is muted
 * (`useSoundSettings`), sounds already waiting included; waiting sounds are dropped on unmount.
 */
import { useEffect, useState } from "react";
import { useSoundSettings } from "../_shared/SoundContext";
import { acquireSound, type SoundHold } from "../_shared/soundPool";
import { CASCADE_SOUNDS, LAZY_CASCADE_SOUNDS, soundSetFor, type CascadeSoundName } from "./sounds";
import type { TierSetId } from "./tiers";
import { createSoundPacer, type SoundPacer } from "./soundPacer";

/** What the pacer's player reads at play time; written by the hook's effects. */
interface PlayerState {
  muted: boolean;
  registry: Readonly<Record<CascadeSoundName, number>>;
  /** The active set's holds; null once released, so a late timer never creates a player. */
  holds: Map<CascadeSoundName, SoundHold> | null;
}

/** The hold for `name`, created on first use (a lazy sound); null once the set is released. */
function holdFor(state: PlayerState, name: CascadeSoundName, volume: number): SoundHold | null {
  const holds = state.holds;
  if (!holds) return null;
  let hold = holds.get(name);
  if (!hold) {
    const source = state.registry[name];
    if (source == null) return null;
    hold = acquireSound(source, volume, true);
    holds.set(name, hold);
  }
  return hold;
}

interface Player {
  readonly pacer: SoundPacer;
  setMuted(muted: boolean): void;
  /** Takes `set`'s eager players; returns the release (its lazy ones included). */
  take(set: TierSetId): () => void;
  /** Creates `name`'s player ahead of its first play. */
  warm(name: CascadeSoundName): void;
}

/** The pacer on real time and timers, playing through the active set's holds. */
function createPlayer(muted: boolean): Player {
  const state: PlayerState = { muted, registry: CASCADE_SOUNDS.fruits, holds: null };
  const pacer = createSoundPacer({
    now: () => performance.now(),
    schedule: (run, delayMs) => {
      setTimeout(run, delayMs);
    },
    play: (name, volume, fromSeconds) => {
      if (state.muted) return;
      holdFor(state, name, volume)?.play(volume, fromSeconds);
    },
    prewarm: (name) => {
      holdFor(state, name, 1);
    },
    stop: (name) => {
      state.holds?.get(name)?.stop();
    },
  });
  return {
    pacer,
    setMuted(m) {
      state.muted = m;
    },
    take(set) {
      const registry = CASCADE_SOUNDS[set];
      const holds = new Map<CascadeSoundName, SoundHold>();
      for (const [name, source] of Object.entries(registry) as [CascadeSoundName, number][]) {
        if (!LAZY_CASCADE_SOUNDS.has(name)) holds.set(name, acquireSound(source, 1, false));
      }
      state.registry = registry;
      state.holds = holds;
      return () => {
        if (state.holds === holds) state.holds = null;
        for (const hold of holds.values()) hold.release();
        holds.clear();
      };
    },
    warm(name) {
      holdFor(state, name, 1);
    },
  };
}

export function useCascadeSounds(setId: string, reduceMotion = false, nearWin = false): SoundPacer {
  const { muted } = useSoundSettings();
  const set = soundSetFor(setId);
  const [player] = useState(() => createPlayer(muted));
  const { pacer } = player;

  useEffect(() => player.setMuted(muted), [player, muted]);
  useEffect(() => player.take(set), [player, set]);
  useEffect(() => pacer.setCalm(reduceMotion), [pacer, reduceMotion]);
  // The win is likely: create its player now, not at the winning merge (a set switch re-runs it).
  useEffect(() => {
    if (nearWin) {
      player.warm("win");
      player.warm("merge-t11");
    }
  }, [player, nearWin, set]);
  useEffect(() => () => pacer.reset(), [pacer]);
  return pacer;
}
