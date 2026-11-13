import { createAudioPlayer, type AudioPlayer } from "expo-audio";
import { GAME_AUDIO_PLAYER_OPTIONS, retainAudioSession } from "./audioSession";

// Upper bound on how long one seekTo()→play() chain may hold a player's in-flight guard. A
// native seek whose completion handler never fires (iOS AVPlayer item not ready yet, audio
// session interruption) leaves its promise pending forever; without a bound that one stuck
// chain would mute this sound for the rest of the screen's lifetime.
export const PENDING_PLAY_TIMEOUT_MS = 1000;

/**
 * Shared one-shot players (#3604): one `AudioPlayer` per distinct asset, however many `useSound`
 * slots play it (card-place-1.ogg is the registry value of several keys). A player is created by
 * the first `acquireSound` of its asset and removed by the last `release`; each player holds
 * exactly one `retainAudioSession()` for its lifetime, so a player that is never created (a lazy
 * sound that is never played) never touches the audio session, and one that is destroyed gives it
 * back. Loop sounds are not pooled (`useLoopSound` mutates `loop`).
 */
interface PoolEntry {
  readonly player: AudioPlayer;
  readonly releaseSession: () => void;
  refs: number;
  volume: number;
  removed: boolean;
  /** True until the first play of a lazily created player, which is already at position 0. */
  fresh: boolean;
  /** Start time of the in-flight seekTo→play chain; null when idle. See PENDING_PLAY_TIMEOUT_MS. */
  pendingSince: number | null;
}

const pool = new Map<number, PoolEntry>();

export interface SoundHold {
  /** Starts playback; false when dropped by the in-flight guard or the hold is released. */
  play: (volume: number) => boolean;
  stop: () => void;
  setVolume: (volume: number) => void;
  /** Idempotent. The last hold of an asset removes its player and releases the audio session. */
  release: () => void;
}

/**
 * Takes a hold on the shared player for `source`, creating it (and retaining the audio session)
 * if no one holds it yet. `lazy` marks a player created on first play rather than at mount: its
 * first play skips the redundant seekTo(0), saving a native round trip on a not-yet-ready item.
 */
export function acquireSound(source: number, volume: number, lazy: boolean): SoundHold {
  let entry = pool.get(source);
  if (!entry) {
    // keepAudioSessionActive: a one-shot SFX finishing must not deactivate the iOS audio
    // session under the background music (#2923). See audioSession.ts for the trade-off.
    const player = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
    player.volume = volume;
    entry = {
      player,
      releaseSession: retainAudioSession(),
      refs: 0,
      volume,
      removed: false,
      fresh: lazy,
      pendingSince: null,
    };
    pool.set(source, entry);
  }
  const e = entry;
  e.refs += 1;
  let released = false;

  const setVolume = (v: number) => {
    if (e.removed || e.volume === v) return;
    e.volume = v;
    e.player.volume = v;
  };

  return {
    setVolume,
    play: (volume) => {
      if (released || e.removed) return false;
      const startedAt = Date.now();
      // Guards against a burst of rapid play() calls (e.g. Star Swarm's 4x lightning fire rate,
      // ~14/s) each spawning their own seekTo()→play() promise chain against the one shared
      // player: unbounded pending native-bridge round trips stutter the RAF game loop. One
      // in-flight chain per player; a call that arrives meanwhile is dropped, not queued.
      if (e.pendingSince !== null && startedAt - e.pendingSince < PENDING_PLAY_TIMEOUT_MS) {
        return false;
      }
      e.pendingSince = startedAt;
      // Only the chain that currently holds the guard may release it.
      const done = () => {
        if (e.pendingSince === startedAt) e.pendingSince = null;
      };
      try {
        setVolume(volume);
        const rewind = e.fresh ? undefined : e.player.seekTo(0);
        e.fresh = false;
        // Await the seek before playing — on web seekTo is async and calling play() while
        // the element is still seeking causes an AbortError that silently drops the sound.
        Promise.resolve(rewind)
          .then(() => {
            // The last hold may have been released while the seek was pending.
            if (!e.removed) return e.player.play();
          })
          .catch(() => {})
          .finally(done);
      } catch {
        // expo-audio may throw on web if audio context is suspended; fail silently.
        done();
        return false;
      }
      return true;
    },
    stop: () => {
      if (released || e.removed) return;
      try {
        e.player.pause();
        Promise.resolve(e.player.seekTo(0)).catch(() => {});
      } catch {
        // expo-audio may throw on web; nothing useful to do about it.
      }
    },
    release: () => {
      if (released) return;
      released = true;
      e.refs -= 1;
      if (e.refs > 0) return;
      e.removed = true;
      pool.delete(source);
      // pause() first: remove() alone does not stop native playback.
      try {
        e.player.pause();
      } catch {
        // audio cleanup, failure is safe
      }
      e.player.remove();
      e.releaseSession();
      e.pendingSince = null;
    },
  };
}

/**
 * Number of live pooled players.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function pooledPlayerCountForTests(): number {
  return pool.size;
}
