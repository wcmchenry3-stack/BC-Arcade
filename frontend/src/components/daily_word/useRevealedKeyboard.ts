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
import type { DailyWordState, TileState } from "../../game/daily_word/types";
import { FLIP_HALF_MS, TILE_STAGGER_MS } from "./WordTile";

export function useRevealedKeyboard(
  state: DailyWordState | null,
  flippingRowIndex: number | null
): DailyWordState["keyboard_state"] {
  const tiles = flippingRowIndex === null ? undefined : state?.rows[flippingRowIndex]?.tiles;
  const count = tiles?.length ?? 0;
  // How many of a guess's tiles have turned over, keyed by that guess's tiles: each scored guess
  // is a new array, so a new flip starts from none in its first render. Keying by row index would
  // not do: Play Again's first guess flips row 0 again (#3667 review).
  const [progress, setProgress] = useState<{
    tiles: readonly TileState[] | undefined;
    turned: number;
  }>({ tiles: undefined, turned: 0 });
  const turned = tiles !== undefined && progress.tiles === tiles ? progress.turned : 0;

  useEffect(() => {
    if (!tiles || count === 0) return;
    const timers = Array.from({ length: count }, (_, i) =>
      setTimeout(() => setProgress({ tiles, turned: i + 1 }), i * TILE_STAGGER_MS + FLIP_HALF_MS)
    );
    return () => timers.forEach(clearTimeout);
  }, [tiles, count]);

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
