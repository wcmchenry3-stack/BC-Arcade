import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer, AudioPlayer } from "expo-audio";
import { useSoundSettings } from "./SoundContext";

export function useSound(
  key: string,
  registry: Record<string, number>,
  volume = 1.0
): { play: () => void } {
  const { muted } = useSoundSettings();
  const playerRef = useRef<AudioPlayer | null>(null);
  const mutedRef = useRef(muted);
  // Guards against a burst of rapid play() calls (e.g. Star Swarm's 4x lightning fire rate,
  // ~14/s) each spawning their own seekTo()→play() promise chain against the one shared
  // player. Overlapping chains stack up pending native-bridge round trips with no bound,
  // which is enough JS-thread/bridge pressure to visibly stutter the RAF game loop driving
  // this same thread. One in-flight chain at a time; a call that arrives while one is
  // already pending is dropped rather than queued — inaudible at this rate, and far cheaper
  // than a growing backlog of bridge calls.
  const pendingRef = useRef(false);

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

  const play = useCallback(() => {
    if (mutedRef.current) return;
    const player = playerRef.current;
    if (!player) return;
    if (pendingRef.current) return;
    pendingRef.current = true;
    try {
      // Await the seek before playing — on web seekTo is async and calling play() while
      // the element is still seeking causes an AbortError that silently drops the sound.
      Promise.resolve(player.seekTo(0))
        .then(() => Promise.resolve(player.play()))
        .catch(() => {})
        .finally(() => {
          pendingRef.current = false;
        });
    } catch {
      // expo-audio may throw on web if audio context is suspended; fail silently.
      pendingRef.current = false;
    }
  }, []);

  return { play };
}
