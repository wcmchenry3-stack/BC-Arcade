/**
 * useOpeningZoom (#3612): a layout whose tiles are too small at fit (`opensZoomedIn`, under
 * OPENING_ZOOM_TILE_PX) opens zoomed in to readable tiles on its top-left corner, where the
 * mini-map shows the rest. The player can turn it off in the ⋯ menu ("Open zoomed in"); the
 * choice is stored, and on until they make one.
 *
 * It applies to a board no pair has been removed from, whenever the camera fits it anew (a new
 * deal, its first layout, a rotation), never to a game in progress.
 */
import { useCallback, useEffect, useState } from "react";
import type { BoardCamera } from "./layout";
import { opensZoomedIn } from "./zoom";
import { loadOpeningZoom, saveOpeningZoom } from "./storage";

export function useOpeningZoom(
  board: { dealId: string; pairsRemoved: number } | null,
  camera: Pick<BoardCamera, "scale" | "tileWidth">,
  zoomInAt: (x: number, y: number) => void
): { enabled: boolean; setEnabled: (enabled: boolean) => void } {
  // Null while the stored choice is loading: the board waits at fit rather than jump twice.
  const [choice, setChoice] = useState<boolean | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    void loadOpeningZoom().then((stored) => {
      if (alive) setChoice((prev) => (prev === undefined ? stored : prev));
    });
    return () => {
      alive = false;
    };
  }, []);
  const enabled = choice !== false;

  const setEnabled = useCallback((next: boolean) => {
    setChoice(next);
    void saveOpeningZoom(next);
  }, []);

  const fresh = board !== null && board.pairsRemoved === 0;
  useEffect(() => {
    if (!fresh || choice === undefined || !enabled) return;
    if (opensZoomedIn(camera.scale, camera.tileWidth)) zoomInAt(0, 0);
    // A new deal or a new fit re-applies it; zoomInAt is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [board?.dealId, fresh, camera.scale, camera.tileWidth, choice === undefined]);

  return { enabled, setEnabled };
}
