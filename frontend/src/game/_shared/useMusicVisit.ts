/**
 * #3638 (epic #3635): the per-visit side of `useBackgroundMusic` — carry-over, starting points, the
 * resume point and the fade-in — kept apart so the shared hook stays readable. Off unless the
 * caller passes `cuesMs`; without options `useBackgroundMusic` behaves exactly as before (Mahjong).
 */
import { useEffect, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { AudioPlayer, AudioStatus } from "expo-audio";
import { nextCue } from "./nextCue";

// The shared music volume, low enough to sit behind SFX. A game whose track is mastered quieter
// passes its own `volume` option (Star Swarm).
const BG_VOLUME = 0.2;

// The fade-in that opens a visit: BGM_FADE_IN_STEPS volume steps from 0 to the target volume over
// BGM_FADE_IN_MS. Once per visit, never on the frame path.
export const BGM_FADE_IN_MS = 1500;
export const BGM_FADE_IN_STEPS = 10;
// If no loaded status arrives within this long of a visit's first player, the seek is given up:
// the track fades in from where it is, rather than waiting silent at volume 0 for good.
export const BGM_SEEK_TIMEOUT_MS = 3000;

// All optional; without them the music behaves as it always has.
//   volume: the player volume (default BG_VOLUME, 0.2). Changes apply to the playing track.
//   cuesMs: the track's starting points. Setting them turns on carry-over: the first player of a
//     visit is kept for the whole visit, so a newGameTick or an active false→true edge resumes it
//     from where game over paused it, instead of picking and restarting a track. The visit opens
//     with a BGM_FADE_IN_MS fade-in from 0 to `volume`.
//   resumeKey: the AsyncStorage key of the resume point (needs cuesMs). On leaving (unmount, or
//     the app going to the background) the first cue after the current position is written,
//     once per leave and never during play. The next visit seeks there once, on the first load.
export interface BackgroundMusicOptions {
  readonly volume?: number;
  readonly cuesMs?: readonly number[];
  readonly resumeKey?: string;
}

interface MusicVisit {
  /** Carry-over is on (cues given): keep the visit's player instead of starting a new track. */
  carryOver(): boolean;
  /** The volume a new player is created at: 0 with carry-over (the fade-in raises it). */
  initialVolume(): number;
  /** A new player was created: with carry-over, seek to the visit's start cue, then fade in. */
  begin(player: AudioPlayer): void;
  /** Ends a running fade-in at the target volume (pause, mute, game over). */
  cancelFade(): void;
  /** Drops the fade and a pending seek; call before the player is released. */
  dispose(): void;
  /** Writes the resume point, once per leave; call before the player is released. */
  saveResumePoint(): void;
}

type Ref<T> = { current: T };

export function useMusicVisit(
  playerRef: Ref<AudioPlayer | null>,
  shouldPlayRef: Ref<() => boolean>,
  options: BackgroundMusicOptions | undefined
): MusicVisit {
  const volume = options?.volume ?? BG_VOLUME;
  const cuesMs = options?.cuesMs;
  const resumeKey = options?.resumeKey;
  const [visit] = useState(() =>
    createMusicVisit(playerRef, shouldPlayRef, { volume, cuesMs, resumeKey })
  );

  // Options are read at call time, so a fresh options object each render changes nothing.
  useEffect(() => visit.setOptions(cuesMs, resumeKey), [visit, cuesMs, resumeKey]);

  // A volume change (the Star Swarm dev mixer) reaches the playing track.
  useEffect(() => visit.changeVolume(volume), [visit, volume]);

  // Going to the background, or inactive, is a leave — save the resume point (the app may be
  // killed there: an iOS app-switcher swipe kills it from inactive, without background or
  // unmount, as StarSwarmScreen also assumes for paused runs). Coming back starts a new stay,
  // whose leave writes again; inactive then background is one leave, one write. No listener
  // without a resumeKey (Mahjong adds nothing).
  useEffect(() => {
    if (!resumeKey) return;
    let subscription: { remove: () => void } | null = null;
    try {
      subscription = AppState.addEventListener("change", (state) => {
        if (state === "background" || state === "inactive") visit.saveResumePoint();
        else if (state === "active") visit.cameBack();
      });
    } catch {
      // no AppState events on this platform — the unmount save still runs
    }
    return () => {
      try {
        subscription?.remove();
      } catch {
        // cleanup, failure is safe
      }
    };
  }, [visit, resumeKey]);

  return visit;
}

function createMusicVisit(
  playerRef: Ref<AudioPlayer | null>,
  shouldPlayRef: Ref<() => boolean>,
  initial: BackgroundMusicOptions & { volume: number }
) {
  let volume = initial.volume;
  let cues = initial.cuesMs;
  let resumeKey = initial.resumeKey;
  // The visit's start cue, read from storage once, when the first player is created.
  let startCue: Promise<number> | null = null;
  let disposeIntro: (() => void) | null = null;
  // True from the creation of a carry-over player until its fade-in ends or is cut short: the
  // intro owns player.volume meanwhile, so a live volume change does not unmute the wait at 0.
  let introOwnsVolume = false;
  // True once the visit's seek has landed (only then is the position worth saving).
  let introDone = false;
  let fadeTimer: ReturnType<typeof setInterval> | null = null;
  // Set when the resume point has been written for the current leave.
  let savedForLeave = false;

  const carryOver = () => (cues?.length ?? 0) > 0;

  const stopFade = () => {
    if (fadeTimer !== null) clearInterval(fadeTimer);
    fadeTimer = null;
    introOwnsVolume = false;
  };

  const cancelFade = () => {
    if (fadeTimer === null) return;
    stopFade();
    if (playerRef.current) setVolume(playerRef.current, volume);
  };

  // Once the visit's seek has landed. When the music is not meant to be audible at that moment
  // (muted, paused, game over) it skips straight to the target volume.
  const startFade = () => {
    introDone = true;
    const player = playerRef.current;
    if (!player) return;
    if (!shouldPlayRef.current()) {
      introOwnsVolume = false;
      setVolume(player, volume);
      return;
    }
    let step = 0;
    fadeTimer = setInterval(() => {
      step += 1;
      const current = playerRef.current;
      if (current)
        setVolume(current, (volume * Math.min(step, BGM_FADE_IN_STEPS)) / BGM_FADE_IN_STEPS);
      if (step >= BGM_FADE_IN_STEPS || !current) stopFade();
    }, BGM_FADE_IN_MS / BGM_FADE_IN_STEPS);
  };

  return {
    carryOver,
    initialVolume: () => (carryOver() ? 0 : volume),
    begin(player: AudioPlayer) {
      if (!carryOver()) return;
      introOwnsVolume = true;
      introDone = false;
      startCue ??= readResumeCue(resumeKey, cues ?? []);
      disposeIntro = attachIntro(player, startCue, () => {
        disposeIntro = null;
        startFade();
      });
    },
    cancelFade,
    dispose() {
      stopFade();
      disposeIntro?.();
      disposeIntro = null;
    },
    // Skipped before the visit's seek has landed: the position would still be the pre-seek one.
    saveResumePoint() {
      const player = playerRef.current;
      if (savedForLeave || !resumeKey || !cues?.length || !player || !introDone) return;
      let positionMs: number;
      try {
        positionMs = player.currentTime * 1000;
      } catch {
        return; // player already gone natively — keep the previous resume point
      }
      savedForLeave = true;
      writeResumeCue(resumeKey, nextCue(positionMs, cues));
    },
    cameBack() {
      savedForLeave = false;
    },
    setOptions(nextCues: readonly number[] | undefined, nextKey: string | undefined) {
      cues = nextCues;
      resumeKey = nextKey;
    },
    // Skipped when unchanged (on mount), so a player is never set twice.
    changeVolume(next: number) {
      if (next === volume) return;
      volume = next;
      const player = playerRef.current;
      if (player && !introOwnsVolume) setVolume(player, next);
    },
  };
}

function setVolume(player: AudioPlayer, volume: number): void {
  try {
    player.volume = volume;
  } catch {
    // player already released natively — nothing to set
  }
}

// The saved start cue, validated: it must be one of the cues. Anything else (missing, unreadable,
// out of range) and any storage error gives 0:00. Never rejects.
async function readResumeCue(key: string | undefined, cuesMs: readonly number[]): Promise<number> {
  if (!key) return 0;
  try {
    const raw = await AsyncStorage.getItem(key);
    if (raw == null) return 0;
    const value = Number(raw);
    return Number.isInteger(value) && cuesMs.includes(value) ? value : 0;
  } catch {
    return 0;
  }
}

function writeResumeCue(key: string, cueMs: number): void {
  try {
    AsyncStorage.setItem(key, String(cueMs)).catch(() => {
      // a lost resume point only means the next visit starts at 0:00
    });
  } catch {
    // storage unavailable — same as above
  }
}

// Seeks a new carry-over player to the visit's start cue, then calls onReady (which starts the
// fade-in). The player plays from creation at volume 0, exactly as before, so the #2923 self-heal
// sees the same play()/status sequence; only the volume and the position differ.
//
// Why the seek waits for the first loaded status rather than running before play(): on iOS,
// expo-audio's seekTo calls AVPlayer.seek(to:completionHandler:), and AVFoundation raises an
// exception for a seek with a completion handler on an item that is not yet readyToPlay. On web,
// setting currentTime before the media has metadata can be dropped. Android's ExoPlayer accepts
// either. So the seek runs once the player reports isLoaded (or at once if it already does), and
// at once where status events are unavailable. Cue 0 needs no seek.
function attachIntro(
  player: AudioPlayer,
  startCueMs: Promise<number>,
  onReady: () => void
): () => void {
  let disposed = false;
  let cue: number | null = null;
  let seeking = false;
  let subscription: { remove: () => void } | null = null;
  let giveUp: ReturnType<typeof setTimeout> | null = null;

  const dispose = () => {
    disposed = true;
    if (giveUp !== null) clearTimeout(giveUp);
    giveUp = null;
    try {
      subscription?.remove();
    } catch {
      // audio cleanup, failure is safe
    }
    subscription = null;
  };

  const finish = () => {
    if (disposed) return;
    dispose();
    onReady();
  };

  const trySeek = () => {
    if (disposed || seeking || cue === null) return;
    // Wait for the loaded status, even for a 0:00 start: fading in before the audio is ready would
    // cut the fade short, or let a slow load start at full volume (the timeout below still applies).
    if (subscription !== null && !player.isLoaded) return;
    if (cue === 0) {
      finish();
      return;
    }
    seeking = true;
    let pending: Promise<void> | undefined;
    try {
      pending = player.seekTo(cue / 1000);
    } catch {
      pending = undefined; // the track just starts at 0:00
    }
    Promise.resolve(pending)
      .catch(() => {
        // a failed seek leaves the track at 0:00, still faded in
      })
      .then(finish);
  };

  try {
    subscription = player.addListener("playbackStatusUpdate", (status: AudioStatus) => {
      if (status.isLoaded) trySeek();
    });
  } catch {
    subscription = null; // no status events on this platform — seek as soon as the cue is known
  }

  startCueMs.then((value) => {
    cue = value;
    trySeek();
  });

  // Fallback: no loaded status (or no stored cue) within BGM_SEEK_TIMEOUT_MS — skip the seek and
  // fade in from where the track is. A seek already in flight may still land.
  giveUp = setTimeout(finish, BGM_SEEK_TIMEOUT_MS);

  return dispose;
}
