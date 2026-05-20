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
    try {
      player.seekTo(0);
      // On web play() returns a Promise; catch AbortError from unmount-triggered pause races.
      Promise.resolve(player.play()).catch(() => {});
    } catch {
      // expo-audio may throw on web if audio context is suspended; fail silently.
    }
  }, []);

  return { play };
}
