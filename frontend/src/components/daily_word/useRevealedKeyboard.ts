/**
 * useRevealedKeyboard (#3663): the keyboard the player sees. While a row flips, each key keeps
 * the colour it had before that guess until the tile for its letter has turned over, so the keys
 * never give the result away ahead of the tiles. Otherwise it is the game's own keyboard state.
 *
 * A tile shows its colour at the midpoint of its flip (`flipDelay + FLIP_HALF_MS`, `WordTile`),
 * so the key follows it at the same moment. A restored or finished board shows the final
 * keyboard at once.
 */
import { useEffect, useMemo, useState } from "react";

import { keyboardWith } from "../../game/daily_word/engine";
import type { DailyWordState } from "../../game/daily_word/types";
import { FLIP_HALF_MS, TILE_STAGGER_MS } from "./WordTile";

export function useRevealedKeyboard(
  state: DailyWordState | null,
  flippingRowIndex: number | null
): DailyWordState["keyboard_state"] {
  // How many of a row's tiles have turned over. Keyed by row, so a new flip starts from none in
  // its first render (not from the last row's count until an effect resets it).
  const [progress, setProgress] = useState({ row: -1, turned: 0 });
  const turned = progress.row === flippingRowIndex ? progress.turned : 0;
  const tiles = flippingRowIndex === null ? undefined : state?.rows[flippingRowIndex]?.tiles;
  const count = tiles?.length ?? 0;

  useEffect(() => {
    if (flippingRowIndex === null || count === 0) return;
    const row = flippingRowIndex;
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setProgress({ row, turned: i + 1 }), i * TILE_STAGGER_MS + FLIP_HALF_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [flippingRowIndex, count]);

  return useMemo(() => {
    if (!state) return {};
    if (flippingRowIndex === null || !tiles) return state.keyboard_state;
    // The keyboard before this guess (the rows above it), plus the tiles turned so far.
    const before = state.rows
      .slice(0, flippingRowIndex)
      .reduce((kb, row) => keyboardWith(kb, row.tiles), {} as DailyWordState["keyboard_state"]);
    return keyboardWith(before, tiles.slice(0, turned));
  }, [state, flippingRowIndex, tiles, turned]);
}
