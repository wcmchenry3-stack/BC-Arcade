/**
 * Cascade's tier-scaled merge sound (moved out of `CascadeScreen.tsx` in #2960): one player for
 * `cascade.fruitMerge`, louder for bigger merges (volume 0.35 at tier 0, 0.065 more per tier,
 * capped at 1). Silent while the game sound is muted. The sound story (#3702) replaces it.
 */
import { useCallback, useEffect, useRef } from "react";
import { createAudioPlayer } from "expo-audio";
import { GAME_AUDIO_PLAYER_OPTIONS, retainAudioSession } from "../_shared/audioSession";
import { useSoundSettings } from "../_shared/SoundContext";
import { CASCADE_SOUNDS } from "./sounds";

/** The merge sound's volume for a merge into `tier`. */
export function mergeVolume(tier: number): number {
  return Math.min(1, 0.35 + tier * 0.065);
}

/** Returns `play(tier)`. */
export function useTieredMergeSound(): (tier: number) => void {
  const { muted } = useSoundSettings();
  const mutedRef = useRef(muted);
  useEffect(() => {
    mutedRef.current = muted;
  }, [muted]);

  const playerRef = useRef<ReturnType<typeof createAudioPlayer> | null>(null);
  useEffect(() => {
    const source = CASCADE_SOUNDS["cascade.fruitMerge"];
    if (!source) return;
    // Same session handling as useSound: see GAME_AUDIO_PLAYER_OPTIONS in audioSession.ts.
    const player = createAudioPlayer(source, GAME_AUDIO_PLAYER_OPTIONS);
    playerRef.current = player;
    const releaseSession = retainAudioSession();
    return () => {
      try {
        player.pause();
      } catch {
        // audio cleanup, failure is safe
      }
      player.remove();
      releaseSession();
      playerRef.current = null;
    };
  }, []);

  return useCallback((tier: number) => {
    if (mutedRef.current || !playerRef.current) return;
    try {
      (playerRef.current as unknown as { volume: number }).volume = mergeVolume(tier);
      playerRef.current.seekTo(0);
      playerRef.current.play();
    } catch {
      /* expo-audio may throw if audio context is suspended */
    }
  }, []);
}
