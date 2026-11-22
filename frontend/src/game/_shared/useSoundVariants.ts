import { useCallback, useEffect, useMemo, useRef } from "react";
import { useSound, type SoundOptions } from "./useSound";

/** The most variations one sound can have: one player slot each (#3563). */
export const MAX_SOUND_VARIANTS = 3;

/**
 * One sound with up to MAX_SOUND_VARIANTS recorded variations, e.g. card place (#3563). `play()`
 * picks a random variation, never the same one twice in a row, so a sound that repeats fast
 * (Auto-Complete plays one card every 120 ms) doesn't sound mechanical. Each variation has its own
 * player slot, so it keeps the mute setting and burst guard of `useSound`, and one card's tail can
 * ring on under the next instead of being cut off by a restart.
 *
 * `keys` lists the registry keys of the variations (at most MAX_SOUND_VARIANTS are used; the slots
 * are sized from that constant, so raising it needs no other change). A key with no entry in the
 * registry is skipped. The usable variations are worked out once per `keys` / `registry`, not on
 * every play. `options.lazy` creates each variation's player on its first play (see SoundOptions).
 */
export function useSoundVariants(
  keys: readonly string[],
  registry: Record<string, number>,
  volume = 1.0,
  random: () => number = Math.random,
  options?: SoundOptions
): { play: () => boolean } {
  const slotKeys = useMemo(() => keys.slice(0, MAX_SOUND_VARIANTS), [keys]);
  // One `useSound` per slot, MAX_SOUND_VARIANTS of them. The trip count is a module constant, so
  // the hook order is the same on every render whatever `keys.length` is.
  const players: { play: () => boolean }[] = [];
  for (let i = 0; i < MAX_SOUND_VARIANTS; i++) {
    // eslint-disable-next-line react-hooks/rules-of-hooks -- constant trip count, see above
    players.push(useSound(slotKeys[i] ?? "", registry, volume, options));
  }
  const usable = useMemo(
    () => slotKeys.map((key, i) => (registry[key] == null ? -1 : i)).filter((i) => i >= 0),
    [slotKeys, registry]
  );
  const lastRef = useRef(-1);
  // The slots' `play`s, read at call time: each is stable (or, in a test double, replaced per
  // render), so `play` below stays stable without a variable-size dependency list.
  const playsRef = useRef<(() => boolean)[]>([]);
  useEffect(() => {
    playsRef.current = players.map((p) => p.play);
  });

  // `keys` should be a module constant (e.g. SOLITAIRE_CARD_PLACE), so `play` stays stable.
  const play = useCallback((): boolean => {
    if (usable.length === 0) return false;
    const choices = usable.length > 1 ? usable.filter((i) => i !== lastRef.current) : usable;
    const pick = choices[Math.min(choices.length - 1, Math.floor(random() * choices.length))]!;
    lastRef.current = pick;
    // Before the first effect there are no players yet, as with `useSound`: nothing plays.
    return playsRef.current[pick]?.() ?? false;
  }, [usable, random]);

  return { play };
}
