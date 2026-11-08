import { useCallback, useRef } from "react";
import { useSound } from "./useSound";

/** The most variations one sound can have: one `useSound` player per slot. */
export const MAX_SOUND_VARIANTS = 3;

/**
 * One sound with up to three recorded variations, e.g. card place (#3563). `play()` picks a
 * random variation, never the same one twice in a row, so a sound that repeats fast (Auto-Complete
 * plays one card every 120 ms) doesn't sound mechanical. Each variation is its own `useSound`
 * player, so it keeps that hook's mute setting and burst guard, and one card's tail can ring on
 * under the next instead of being cut off by a restart.
 *
 * `keys` lists the registry keys of the variations; extra slots are unused. A key with no entry
 * in the registry is skipped.
 */
export function useSoundVariants(
  keys: readonly string[],
  registry: Record<string, number>,
  volume = 1.0,
  random: () => number = Math.random
): { play: () => boolean } {
  // A fixed number of hook calls (no loop), so the rules of hooks hold for any `keys` length.
  const { play: playA } = useSound(keys[0] ?? "", registry, volume);
  const { play: playB } = useSound(keys[1] ?? "", registry, volume);
  const { play: playC } = useSound(keys[2] ?? "", registry, volume);
  const lastRef = useRef(-1);

  // `keys` should be a module constant (e.g. SOLITAIRE_CARD_PLACE), so `play` stays stable.
  const play = useCallback((): boolean => {
    const players = [playA, playB, playC];
    const usable = keys
      .slice(0, MAX_SOUND_VARIANTS)
      .map((key, i) => (registry[key] == null ? -1 : i))
      .filter((i) => i >= 0);
    if (usable.length === 0) return false;
    const choices = usable.length > 1 ? usable.filter((i) => i !== lastRef.current) : usable;
    const pick = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
    lastRef.current = pick;
    return players[pick]!();
  }, [playA, playB, playC, keys, registry, random]);

  return { play };
}
