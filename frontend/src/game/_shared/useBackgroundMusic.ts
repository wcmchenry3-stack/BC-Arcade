import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { createAudioPlayer, AudioPlayer, type AudioStatus } from "expo-audio";
import { useSoundSettings } from "./SoundContext";
import { GAME_AUDIO_PLAYER_OPTIONS, retainAudioSession } from "./audioSession";

const BG_VOLUME = 0.2;

// Self-heal (#2923): how long after a "loaded but not playing" status to re-check the player,
// and how many extra play() calls one player may get before we give up on it.
export const SELF_HEAL_DELAY_MS = 500;
export const SELF_HEAL_MAX_ATTEMPTS = 3;

// Picks a random track from keys on each active→true transition (new game session).
// Volume is kept low (BG_VOLUME) to sit behind SFX.
//
// newGameTick: increment this on every new-game start (e.g. resetTick from the parent
// screen) to guarantee a fresh session even when active stays true (e.g. new game
// started from the pause screen) or when the active false→true transition misfires on
// some native audio sessions.  The [newGameTick] effect runs before [active] so that
// when both fire in the same React commit the [active] resume-branch plays the track
// that [newGameTick] already started rather than launching a second session.
//
// paused: hold the current track (e.g. while the game is paused) and resume it — the same
// track, from where it stopped — when paused goes false. Unlike active, it never picks a
// new track.
export function useBackgroundMusic(
  keys: string[],
  registry: Record<string, number>,
  active: boolean,
  newGameTick?: number,
  paused = false
): void {
  const { muted } = useSoundSettings();
  const playerRef = useRef<AudioPlayer | null>(null);
  const mutedRef = useRef(muted);
  const keysRef = useRef(keys);
  const registryRef = useRef(registry);
  const prevActiveRef = useRef<boolean | null>(null);
  const pausedRef = useRef(paused);
  const disposeHealRef = useRef<(() => void) | null>(null);

  // Whether the music is meant to be audible right now. The self-heal reads it at check time,
  // so a user pause, mute or game over always wins over a pending re-play.
  const shouldPlayRef = useRef(
    () => prevActiveRef.current === true && !pausedRef.current && !mutedRef.current
  );

  // Hold the shared audio session while this screen is mounted; the release on unmount hands
  // it back to other apps on iOS (see audioSession.ts).
  useEffect(() => retainAudioSession(), []);

  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    keysRef.current = keys;
  }, [keys]);

  useEffect(() => {
    registryRef.current = registry;
  }, [registry]);

  // Declared before [newGameTick] and [active] so pausedRef is current when they run in the
  // same commit (a new game started from the pause screen unpauses and ticks together).
  useEffect(() => {
    pausedRef.current = paused;
    const player = playerRef.current;
    if (!player) return;
    if (paused) {
      player.pause();
    } else if (prevActiveRef.current && !mutedRef.current) {
      try {
        player.play();
      } catch {
        // web AudioContext suspended — fail silently
      }
    }
  }, [paused]);

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
      releasePlayer(playerRef, disposeHealRef);
      return;
    }
    pickAndPlay(
      playerRef,
      disposeHealRef,
      keysRef,
      registryRef,
      mutedRef.current || pausedRef.current,
      shouldPlayRef.current
    );
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
      if (!mutedRef.current && !pausedRef.current && playerRef.current) {
        try {
          playerRef.current.play();
        } catch {
          // web AudioContext suspended — fail silently
        }
      }
      return;
    }

    // New session (null→true on mount, or false→true after game over): pick a new track.
    pickAndPlay(
      playerRef,
      disposeHealRef,
      keysRef,
      registryRef,
      mutedRef.current || pausedRef.current,
      shouldPlayRef.current
    );
  }, [active]);

  // React to mute toggle independently of active.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) {
      player.pause();
    } else if (prevActiveRef.current && !pausedRef.current) {
      try {
        player.play();
      } catch {
        // web AudioContext suspended — fail silently
      }
    }
  }, [muted]);

  // Cleanup on unmount — stops the music before the player is freed (see releasePlayer).
  useEffect(() => {
    return () => {
      releasePlayer(playerRef, disposeHealRef);
    };
  }, []);
}

// Stops and frees the current player. pause() comes first: remove() only drops the player from
// expo-audio's native registry, it does not stop the AVPlayer, which would keep playing until it
// is garbage-collected. With keepAudioSessionActive set, this pause() no longer schedules an iOS
// session deactivation either.
function releasePlayer(
  playerRef: { current: AudioPlayer | null },
  disposeHealRef: { current: (() => void) | null }
): void {
  disposeHealRef.current?.();
  disposeHealRef.current = null;
  const player = playerRef.current;
  playerRef.current = null;
  if (!player) return;
  try {
    player.pause();
  } catch {
    // audio cleanup, failure is safe
  }
  try {
    player.remove();
  } catch {
    // audio cleanup, failure is safe
  }
}

// Self-heal for a BGM player that loads but never starts (#2923). If the audio session is torn
// down while a new player is still loading, its play() is lost and the track stays silent, yet a
// later play() works. So while the player has not yet been seen playing, a status update showing
// it loaded but not playing (and not finished) schedules a check; the check re-issues play() only
// if the music should be audible at that moment.
//
// Guards: only until the player is first seen playing (after that, a stop is deliberate: a user
// pause, a phone call, headphones unplugged, and is left alone); at most SELF_HEAL_MAX_ATTEMPTS
// play() calls per player; one pending check at a time; never while paused, muted, inactive or
// backgrounded; disposed together with the player.
export function attachSelfHeal(player: AudioPlayer, shouldPlay: () => boolean): () => void {
  let confirmed = false;
  let attempts = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clearTimer = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  };

  const check = () => {
    timer = null;
    if (disposed || confirmed) return;
    if (player.playing) {
      confirmed = true;
      return;
    }
    const appAway = AppState.currentState === "background" || AppState.currentState === "inactive";
    if (!player.isLoaded || !shouldPlay() || appAway) return;
    attempts += 1;
    try {
      player.play();
    } catch {
      // web AudioContext suspended — fail silently
    }
    // Look again to confirm it took; stops once the attempt budget is spent.
    schedule();
  };

  function schedule() {
    if (disposed || confirmed || timer !== null || attempts >= SELF_HEAL_MAX_ATTEMPTS) return;
    timer = setTimeout(check, SELF_HEAL_DELAY_MS);
  }

  let subscription: { remove: () => void } | null = null;
  try {
    subscription = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (status.playing) {
        confirmed = true;
        clearTimer();
        return;
      }
      if (status.isLoaded && !status.didJustFinish) schedule();
    });
  } catch {
    // no status events on this platform — the music just isn't self-healed
  }

  return () => {
    disposed = true;
    clearTimer();
    try {
      subscription?.remove();
    } catch {
      // audio cleanup, failure is safe
    }
  };
}

function pickAndPlay(
  playerRef: { current: AudioPlayer | null },
  disposeHealRef: { current: (() => void) | null },
  keysRef: { current: string[] },
  registryRef: { current: Record<string, number> },
  silent: boolean,
  shouldPlay: () => boolean
): void {
  releasePlayer(playerRef, disposeHealRef);

  const currentKeys = keysRef.current;
  const key = currentKeys[Math.floor(Math.random() * currentKeys.length)];
  const source = key != null ? registryRef.current[key] : undefined;
  if (!source) return;

  // keepAudioSessionActive: see GAME_AUDIO_PLAYER_OPTIONS in audioSession.ts.
  const player = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
  player.loop = true;
  player.volume = BG_VOLUME;
  playerRef.current = player;
  disposeHealRef.current = attachSelfHeal(player, shouldPlay);

  if (!silent) {
    try {
      player.play();
    } catch {
      // web AudioContext suspended — fail silently
    }
  }
}
