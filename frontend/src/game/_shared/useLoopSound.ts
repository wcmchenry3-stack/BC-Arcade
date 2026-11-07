import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer, AudioPlayer } from "expo-audio";
import { useSoundSettings } from "./SoundContext";
import { GAME_AUDIO_PLAYER_OPTIONS, retainAudioSession } from "./audioSession";

/**
 * A sound that plays continuously while a condition holds (#3526): a power-up's engine hum, the
 * rout's thruster. The caller states the condition's edges, never its per-frame value:
 * `start()` when it becomes true, `stop()` when it becomes false. Both are idempotent, so a
 * repeated call costs nothing and never restarts the sound.
 *
 * `start()` records that the loop is wanted even while muted; muting stops the player, and
 * unmuting resumes it if it is still wanted. The player is removed on unmount.
 */
export function useLoopSound(
  key: string,
  registry: Record<string, number>,
  volume = 1.0
): { start: () => void; stop: () => void } {
  const { muted } = useSoundSettings();
  const playerRef = useRef<AudioPlayer | null>(null);
  const wantedRef = useRef(false); // the caller's condition
  const playingRef = useRef(false); // whether the player was told to play
  const mutedRef = useRef(muted);

  const sync = useCallback(() => {
    const player = playerRef.current;
    if (!player) return;
    const shouldPlay = wantedRef.current && !mutedRef.current;
    if (shouldPlay === playingRef.current) return;
    playingRef.current = shouldPlay;
    try {
      if (shouldPlay) {
        player.loop = true;
        Promise.resolve(player.seekTo(0))
          .then(() => {
            // stop() may have landed while the seek was pending
            if (playingRef.current) return player.play();
          })
          .catch(() => {});
      } else {
        player.pause();
        Promise.resolve(player.seekTo(0)).catch(() => {});
      }
    } catch {
      // expo-audio may throw on web if the audio context is suspended; fail silently.
    }
  }, []);

  useEffect(() => {
    mutedRef.current = muted;
    sync();
  }, [muted, sync]);

  useEffect(() => {
    const source = registry[key];
    if (source == null) return;
    const player = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
    player.loop = true;
    player.volume = volume;
    playerRef.current = player;
    playingRef.current = false;
    const releaseSession = retainAudioSession();
    // A start() that landed before the player existed.
    sync();
    return () => {
      try {
        player.pause();
      } catch {
        // audio cleanup, failure is safe
      }
      player.remove();
      releaseSession();
      playerRef.current = null;
      playingRef.current = false;
    };
    // volume intentionally excluded — the sync effect below handles live updates
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, registry, sync]);

  // Live volume: a running loop follows the dev-panel mixer.
  useEffect(() => {
    if (playerRef.current) playerRef.current.volume = volume;
  }, [volume]);

  const start = useCallback(() => {
    wantedRef.current = true;
    sync();
  }, [sync]);

  const stop = useCallback(() => {
    wantedRef.current = false;
    sync();
  }, [sync]);

  return { start, stop };
}
