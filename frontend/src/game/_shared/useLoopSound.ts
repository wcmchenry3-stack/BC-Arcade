import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer, AudioPlayer } from "expo-audio";
import { useSoundSettings } from "./SoundContext";
import { GAME_AUDIO_PLAYER_OPTIONS, retainAudioSession } from "./audioSession";
import type { SoundOptions } from "./useSound";

/**
 * A sound that plays continuously while a condition holds (#3526): a power-up's engine hum, the
 * rout's thruster. The caller states the condition's edges, never its per-frame value:
 * `start()` when it becomes true, `stop()` when it becomes false. Both are idempotent, so a
 * repeated call costs nothing and never restarts the sound.
 *
 * `start()` records that the loop is wanted even while muted; muting stops the player, and
 * unmuting resumes it if it is still wanted. The player is removed on unmount.
 *
 * `options.lazy` (#3604): the player is created the first time the loop actually has to play
 * (`start()` while not muted) instead of at mount, and holds the audio session only from then on.
 * Loops are not pooled with one-shots: the player's `loop` flag is this hook's own.
 */
export function useLoopSound(
  key: string,
  registry: Record<string, number>,
  volume = 1.0,
  { lazy = false }: SoundOptions = {}
): { start: () => void; stop: () => void } {
  const { muted } = useSoundSettings();
  const playerRef = useRef<AudioPlayer | null>(null);
  const wantedRef = useRef(false); // the caller's condition
  const playingRef = useRef(false); // whether the player was told to play
  const mutedRef = useRef(muted);

  const sourceRef = useRef<number | null>(null);
  const releaseRef = useRef<(() => void) | null>(null);
  const volumeRef = useRef(volume);
  // True between the registry effect's setup and cleanup; a stale start() must not create a
  // lazy player nobody would remove.
  const aliveRef = useRef(false);

  const sync = useCallback(() => {
    const shouldPlay = wantedRef.current && !mutedRef.current;
    if (shouldPlay === playingRef.current) return;
    if (shouldPlay && !playerRef.current) {
      // A lazy loop's first start: create the player now (synchronous, so never twice).
      const source = sourceRef.current;
      if (source == null || !aliveRef.current) return;
      const created = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
      created.loop = true;
      created.volume = volumeRef.current;
      playerRef.current = created;
      releaseRef.current = retainAudioSession();
    }
    const player = playerRef.current;
    if (!player) return;
    playingRef.current = shouldPlay;
    try {
      if (shouldPlay) {
        player.loop = true;
        Promise.resolve(player.seekTo(0))
          .then(() => {
            // stop() may have landed while the seek was pending
            if (playingRef.current && playerRef.current === player) return player.play();
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
    sourceRef.current = source;
    aliveRef.current = true;
    if (!lazy) {
      const player = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
      player.loop = true;
      player.volume = volumeRef.current;
      playerRef.current = player;
      releaseRef.current = retainAudioSession();
    }
    playingRef.current = false;
    // A start() that landed before the player existed.
    sync();
    return () => {
      aliveRef.current = false;
      sourceRef.current = null;
      const player = playerRef.current;
      if (player) {
        try {
          player.pause();
        } catch {
          // audio cleanup, failure is safe
        }
        player.remove();
      }
      releaseRef.current?.();
      releaseRef.current = null;
      playerRef.current = null;
      playingRef.current = false;
    };
  }, [key, registry, lazy, sync]);

  // Live volume: a running loop follows the dev-panel mixer.
  useEffect(() => {
    volumeRef.current = volume;
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
