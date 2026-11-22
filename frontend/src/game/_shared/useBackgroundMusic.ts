import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { createAudioPlayer, AudioPlayer, type AudioStatus } from "expo-audio";
import { useSoundSettings } from "./SoundContext";
import { GAME_AUDIO_PLAYER_OPTIONS, retainAudioSession } from "./audioSession";
import { useMusicVisit, type BackgroundMusicOptions } from "./useMusicVisit";

// Self-heal (#2923): how long after a "loaded but not playing" status to re-check the player,
// and how many extra play() calls one player may get before we give up on it.
export const SELF_HEAL_DELAY_MS = 500;
export const SELF_HEAL_MAX_ATTEMPTS = 3;

// Two modes, chosen by options.cuesMs:
//   - No options (Mahjong): as before #3638. A random track from keys on each new game session
//     (an active false→true edge or a newGameTick), from 0:00, at 0.2.
//   - With cues (Star Swarm, #3638; see useMusicVisit.ts): one player per visit. Game over pauses
//     it and the next game resumes it from the same position (carry-over). On leaving, the next
//     starting point is saved; the next visit seeks there on first load and fades in to
//     options.volume.
// Either way the volume sits behind SFX (0.2, or options.volume).
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
  paused = false,
  options?: BackgroundMusicOptions
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
  const visit = useMusicVisit(playerRef, shouldPlayRef, options);

  // Stops and frees the current player, with its fade-in and pending seek.
  const release = () => {
    visit.dispose();
    releasePlayer(playerRef, disposeHealRef);
  };
  // A new track; with carry-over (#3638) it starts silent and the visit seeks and fades it in.
  const startTrack = () => {
    release();
    const silent = mutedRef.current || pausedRef.current;
    const player = pickAndPlay(playerRef, disposeHealRef, keysRef, registryRef, silent, {
      shouldPlay: shouldPlayRef.current,
      volume: visit.initialVolume(),
    });
    if (player) visit.begin(player);
  };
  // #3638 carry-over resume: the old self-heal disarmed once the player first played, so a lost
  // resume play() would never be retried. A fresh one (same limits) checks the resume too.
  const resumeCarryOver = (player: AudioPlayer) => {
    disposeHealRef.current?.();
    disposeHealRef.current = attachSelfHeal(player, shouldPlayRef.current, { checkNow: true });
    playSafely(player);
  };

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
      visit.cancelFade();
      player.pause();
    } else if (prevActiveRef.current && !mutedRef.current) {
      playSafely(player);
    }
  }, [paused, visit]); // visit is stable (useState)

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
    const player = playerRef.current;
    if (visit.carryOver() && player) {
      // #3638 carry-over: the same player, from where it is — never a new track or a restart.
      if (!active) {
        visit.cancelFade();
        player.pause();
      } else if (!mutedRef.current && !pausedRef.current) {
        resumeCarryOver(player);
      }
      return;
    }
    if (!active) {
      release();
      return;
    }
    startTrack();
    // active intentionally omitted: we read its value at call-time when newGameTick fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newGameTick]);

  // React to active changing: pause on false, start new track on false→true.
  useEffect(() => {
    const wasActive = prevActiveRef.current;
    prevActiveRef.current = active;

    if (!active) {
      visit.cancelFade();
      playerRef.current?.pause();
      return;
    }

    const player = playerRef.current;
    if (wasActive === true || (visit.carryOver() && player)) {
      // Resuming (e.g. unpause) or continuing after a newGameTick session — play existing.
      // #3638 carry-over: a false→true edge (new game after game over) also resumes the same
      // player, from where game over paused it, with a re-armed self-heal.
      if (!mutedRef.current && !pausedRef.current && player) {
        if (wasActive !== true) resumeCarryOver(player);
        else playSafely(player);
      }
      return;
    }

    // New session (null→true on mount, or false→true after game over): pick a new track.
    startTrack();
    // startTrack only reads refs and the stable visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // React to mute toggle independently of active.
  useEffect(() => {
    const player = playerRef.current;
    if (!player) return;
    if (muted) {
      visit.cancelFade();
      player.pause();
    } else if (prevActiveRef.current && !pausedRef.current) {
      playSafely(player);
    }
  }, [muted, visit]); // visit is stable (useState)

  // Cleanup on unmount — saves the resume point (#3638) while the position is still readable,
  // then stops the music before the player is freed (see releasePlayer).
  useEffect(() => {
    return () => {
      visit.saveResumePoint();
      visit.dispose();
      releasePlayer(playerRef, disposeHealRef);
    };
  }, [visit]);
}

function playSafely(player: AudioPlayer): void {
  try {
    player.play();
  } catch {
    // web AudioContext suspended — fail silently
  }
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
//
// checkNow (#3638): also schedule one check right away, for a carry-over resume. A resumed player
// is already loaded, so a lost play() may bring no new status to react to.
export function attachSelfHeal(
  player: AudioPlayer,
  shouldPlay: () => boolean,
  { checkNow = false }: { checkNow?: boolean } = {}
): () => void {
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
  if (checkNow) schedule();

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
  { shouldPlay, volume }: { shouldPlay: () => boolean; volume: number }
): AudioPlayer | null {
  releasePlayer(playerRef, disposeHealRef);

  const currentKeys = keysRef.current;
  const key = currentKeys[Math.floor(Math.random() * currentKeys.length)];
  const source = key != null ? registryRef.current[key] : undefined;
  if (!source) return null;

  // keepAudioSessionActive: see GAME_AUDIO_PLAYER_OPTIONS in audioSession.ts.
  const player = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
  player.loop = true;
  player.volume = volume;
  playerRef.current = player;
  disposeHealRef.current = attachSelfHeal(player, shouldPlay);

  if (!silent) playSafely(player);
  return player;
}
