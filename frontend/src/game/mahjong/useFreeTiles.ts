/**
 * The free tiles of the board on screen, computed once per board (#2962).
 *
 * MahjongScreen builds this from its state and shares it: the canvas styles and hit-tests with
 * `ids`, the no-moves overlay reads `noFreePairs`, the hint and the dev panel search pairs
 * among `ids`, and a tap passes `ids` to `selectTile`. Before, each of those rebuilt the free
 * set itself with an O(n²) scan.
 */
import { useMemo } from "react";
import { freeTileIds, hasFreePairs } from "./engine";
import type { MahjongState, SlotTile } from "./types";

export interface FreeTiles {
  /** The board these were computed from (empty with no game). */
  readonly tiles: readonly SlotTile[];
  /** `freeTileIds(tiles)`. */
  readonly ids: ReadonlySet<number>;
  /** A game is on and unfinished, and no two free tiles match: shuffle or deadlock. */
  readonly noFreePairs: boolean;
}

const NO_TILES: readonly SlotTile[] = [];

export function useFreeTiles(state: MahjongState | null): FreeTiles {
  const tiles = state?.tiles ?? NO_TILES;
  const board = useMemo(() => {
    const ids = freeTileIds(tiles);
    return { tiles, ids, hasPairs: hasFreePairs(tiles, ids) };
  }, [tiles]);
  const unfinished = state !== null && !state.isComplete;
  return useMemo(
    () => ({ tiles: board.tiles, ids: board.ids, noFreePairs: unfinished && !board.hasPairs }),
    [board, unfinished]
  );
}

/**
 * `free.ids` if they belong to `tiles`, else undefined (the engine then checks for itself). A
 * functional state update can run against a newer board than the one last rendered.
 */
export function freeIdsFor(
  free: FreeTiles,
  tiles: readonly SlotTile[]
): ReadonlySet<number> | undefined {
  return free.tiles === tiles ? free.ids : undefined;
}
