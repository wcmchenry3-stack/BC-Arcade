import { useEffect, useRef } from "react";
import { createAudioPlayer, AudioPlayer } from "expo-audio";
import { useSoundSettings } from "./SoundContext";
import { SOUND_REGISTRY, SoundKey } from "./sounds";

const BG_VOLUME = 0.2;

// Picks a random track from keys on each active→true transition (new game session).
// Volume is kept low (BG_VOLUME) to sit behind SFX.
//
// newGameTick: increment this on every new-game start (e.g. resetTick from the parent
// screen) to guarantee a fresh session even when active stays true (e.g. new game
// started from the pause screen) or when the active false→true transition misfires on
// some native audio sessions.  The [newGameTick] effect runs before [active] so that
// when both fire in the same React commit the [active] resume-branch plays the track
// that [newGameTick] already started rather than launching a second session.
export function useBackgroundMusic(keys: SoundKey[], active: boolean, newGameTick?: number): void {
  const { muted } = useSoundSettings();
  const playerRef = useRef<AudioPlayer | null>(null);
  const mutedRef = useRef(muted);
  const keysRef = useRef(keys);
  const prevActiveRef = useRef<boolean | null>(null);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  // Force a new session on every new-game tick.
  // IMPORTANT: keep this effect declared before [active]. When both deps change in the
  // same commit React flushes effects in declaration order, so this runs first and sets
  // prevActiveRef.current = active before [active] reads it. That causes [active] to see
  // wasActive === active (no transition) and take the resume path rather than launching
  // a redundant second session. Moving this effect after [active] would break that guarantee.
  useEffect(() => {
    if (newGameTick == null || newGameTick <= 0) return;
    // Sync prevActiveRef now so [active] (running next in this flush) skips new-session logic.
    prevActiveRef.current = active;
    if (!active) {
      try {
        playerRef.current?.remove();
      } catch {
        // audio cleanup, failure is safe
      }
      playerRef.current = null;
      return;
    }
    pickAndPlay(playerRef, keysRef, mutedRef);
    // active intentionally omitted: we read its value at call-time when newGameTick fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newGameTick]);

  // React to active changing: pause on false, start new track on false→true.
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;

    if (!active) {
      playerRef.current?.pause();
      return;
    }

    if (wasActive === true) {
      // Resuming (e.g. unpause) or continuing after a newGameTick session — play existing.
      if (!mutedRef.current && playerRef.current) {
        try {
          playerRef.current.play();
        } catch {
          // web AudioContext suspended — fail silently
        }
      }
      return;
    }

    // New session (null→true on mount, or false→true after game over): pick a new track.
    pickAndPlay(playerRef, keysRef, mutedRef);
  }, [active]);

  // React to mute toggle independently of active.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) {
      player.pause();
    } else if (prevActiveRef.current) {
      try {
        player.play();
      } catch {
        // web AudioContext suspended — fail silently
      }
    }
  }, [muted]);

  // Cleanup on unmount — pause first so native audio stops before the player
  // is freed; remove() alone does not halt playback on all platforms.
  useEffect(() => {
    return () => {
      if (playerRef.current) {
        playerRef.current.pause();
        playerRef.current.remove();
      }
      playerRef.current = null;
    };
  }, []);
}

function pickAndPlay(
  playerRef: { current: AudioPlayer | null },
  keysRef: { current: SoundKey[] },
  mutedRef: { current: boolean }
): void {
  try {
    playerRef.current?.remove();
  } catch {
    // audio cleanup, failure is safe
  }
  playerRef.current = null;

  const currentKeys = keysRef.current;
  const key = currentKeys[Math.floor(Math.random() * currentKeys.length)];
  const source = key != null ? SOUND_REGISTRY[key] : undefined;
  if (!source) return;

  const player = createAudioPlayer(source);
  player.loop = true;
  player.volume = BG_VOLUME;
  playerRef.current = player;

  if (!mutedRef.current) {
    try {
      player.play();
    } catch {
      // web AudioContext suspended — fail silently
    }
  }
}
