/**
 * useRefitAsTilesClear (#3612): after each match (or undo), the board camera eases to fit the
 * tiles that remain, so the board grows as it clears. The hook only asks: `refit` (from
 * useBoardZoomPan) declines while a gesture is in progress or the player has zoomed away.
 * Skipped while the no-moves prompt shows (that zooms to the whole board), on the first render
 * of a board (the camera already fits it), and once the board is cleared.
 */
import { useEffect, useRef } from "react";
import type { BoardCamera } from "./layout";
import { tilesBounds } from "./layout";
import type { BoardRect } from "./zoom";
import type { SlotTile } from "./types";

export function useRefitAsTilesClear(
  tiles: readonly SlotTile[] | undefined,
  camera: BoardCamera,
  refit: (rect: BoardRect, reduceMotion: boolean) => boolean,
  reduceMotion: boolean,
  paused: boolean
): void {
  const count = tiles?.length ?? 0;
  const lastCount = useRef(count);
  useEffect(() => {
    const before = lastCount.current;
    lastCount.current = count;
    // A board appearing (from none: a load or a new deal) is already fitted by the camera.
    if (paused || !tiles || count === 0 || before === 0 || count === before) return;
    const rect = tilesBounds(tiles, camera);
    if (rect) refit(rect, reduceMotion);
    // Only a change in the tile count moves the camera; the tiles and camera are read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count]);
}
