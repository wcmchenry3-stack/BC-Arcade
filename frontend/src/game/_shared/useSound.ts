import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer, AudioPlayer } from "expo-audio";
import { useSoundSettings } from "./SoundContext";

// Upper bound on how long one seekTo()→play() chain may hold the in-flight guard below. A
// native seek whose completion handler never fires (iOS AVPlayer item not ready yet, audio
// session interruption) leaves its promise pending forever; without a bound that one stuck
// chain would mute this sound for the rest of the screen's lifetime.
export const PENDING_PLAY_TIMEOUT_MS = 1000;

export function useSound(
  key: string,
  registry: Record<string, number>,
  volume = 1.0
): { play: () => boolean; stop: () => void } {
  const { muted } = useSoundSettings();
  const playerRef = useRef<AudioPlayer | null>(null);
  const mutedRef = useRef(muted);
  // Guards against a burst of rapid play() calls (e.g. Star Swarm's 4x lightning fire rate,
  // ~14/s) each spawning their own seekTo()→play() promise chain against the one shared
  // player. Overlapping chains stack up pending native-bridge round trips with no bound,
  // which is enough JS-thread/bridge pressure to visibly stutter the RAF game loop driving
  // this same thread. One in-flight chain at a time; a call that arrives while one is
  // already pending is dropped rather than queued — inaudible at this rate, and far cheaper
  // than a growing backlog of bridge calls. Holds the start time of the in-flight chain (null
  // when idle) so a chain that never settles stops blocking after PENDING_PLAY_TIMEOUT_MS.
  const pendingSinceRef = useRef<number | null>(null);

  // Keep ref in sync so the stable `play` callback sees the latest muted value.
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  useEffect(() => {
    const source = registry[key];
    if (source == null) return;
    const player = createAudioPlayer(source);
    player.volume = volume;
    playerRef.current = player;
    return () => {
      player.remove();
      playerRef.current = null;
      // A chain still pending against the removed player must not block the next one.
      pendingSinceRef.current = null;
    };
    // volume intentionally excluded — sync effect below handles live updates without recreating the player
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, registry]);

  // Sync volume changes to the live player without recreating it.
  useEffect(() => {
    if (playerRef.current) {
      playerRef.current.volume = volume;
    }
  }, [volume]);

  // Returns whether playback was actually started — false when muted, when the sound has no
  // player, or when the call was dropped by the in-flight guard. Most callers ignore it; a
  // caller that syncs something to the sound's length (Star Swarm's PERFECT hold) needs it.
  const play = useCallback((): boolean => {
    if (mutedRef.current) return false;
    const player = playerRef.current;
    if (!player) return false;
    const startedAt = Date.now();
    const pendingSince = pendingSinceRef.current;
    if (pendingSince !== null && startedAt - pendingSince < PENDING_PLAY_TIMEOUT_MS) return false;
    pendingSinceRef.current = startedAt;
    // Only the chain that currently holds the guard may release it — a timed-out chain that
    // settles late must not clear the guard out from under its replacement.
    const release = () => {
      if (pendingSinceRef.current === startedAt) pendingSinceRef.current = null;
    };
    try {
      // Await the seek before playing — on web seekTo is async and calling play() while
      // the element is still seeking causes an AbortError that silently drops the sound.
      Promise.resolve(player.seekTo(0))
        .then(() => Promise.resolve(player.play()))
        .catch(() => {})
        .finally(release);
    } catch {
      // expo-audio may throw on web if audio context is suspended; fail silently.
      release();
      return false;
    }
    return true;
  }, []);

  // Cuts the sound off and rewinds it — for a long sound (a fanfare) that must not carry on
  // over whatever the player does next.
  const stop = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    try {
      player.pause();
      Promise.resolve(player.seekTo(0)).catch(() => {});
    } catch {
      // Same as play(): expo-audio may throw on web; nothing useful to do about it.
    }
  }, []);

  return { play, stop };
}
