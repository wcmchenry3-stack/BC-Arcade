/**
 * useDailyWordSounds (#3665): the reveal and refusal sounds, timed to the motion.
 *
 * - **Reveal.** While a row flips, each tile plays its result's sound (grey, yellow, green) at
 *   the moment its colour shows, its flip midpoint (`i × TILE_STAGGER_MS + FLIP_HALF_MS`), the
 *   same moment its key changes (`useRevealedKeyboard`). Under Reduce Motion the colours still
 *   change tile by tile at those times, so the sounds do too. A restored board is silent.
 * - **Refusal.** `playRefused` plays with the "no" shake.
 *
 * The sounds follow the player's sound setting through `useSound`.
 */
import { useCallback, useEffect } from "react";

import type { DailyWordState, TileStatus } from "../../game/daily_word/types";
import { FLIP_HALF_MS, TILE_STAGGER_MS } from "../../game/daily_word/motion";
import {
  DAILY_WORD_REVEAL_CORRECT,
  DAILY_WORD_REVEAL_MISS,
  DAILY_WORD_REVEAL_PRESENT,
  DAILY_WORD_SOUNDS,
} from "../../game/daily_word/sounds";
import { useSound } from "../../game/_shared/useSound";
import { useSoundVariants } from "../../game/_shared/useSoundVariants";

export function useDailyWordSounds(
  state: DailyWordState | null,
  flippingRowIndex: number | null
): { playRefused: () => void } {
  const { play: playMiss } = useSoundVariants(DAILY_WORD_REVEAL_MISS, DAILY_WORD_SOUNDS);
  const { play: playPresent } = useSoundVariants(DAILY_WORD_REVEAL_PRESENT, DAILY_WORD_SOUNDS);
  const { play: playCorrect } = useSoundVariants(DAILY_WORD_REVEAL_CORRECT, DAILY_WORD_SOUNDS);
  const { play: playRefusedSound } = useSound("dailyWord.refused", DAILY_WORD_SOUNDS);

  const tiles = flippingRowIndex === null ? undefined : state?.rows[flippingRowIndex]?.tiles;
  useEffect(() => {
    if (!tiles) return;
    const players: Partial<Record<TileStatus, () => boolean>> = {
      absent: playMiss,
      present: playPresent,
      correct: playCorrect,
    };
    const timers = tiles.map((tile, i) =>
      setTimeout(() => players[tile.status]?.(), i * TILE_STAGGER_MS + FLIP_HALF_MS)
    );
    return () => timers.forEach(clearTimeout);
    // A new flip (a new tiles array) schedules its row once; the players are stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiles]);

  const playRefused = useCallback(() => void playRefusedSound(), [playRefusedSound]);
  return { playRefused };
}
