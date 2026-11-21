/** Below this viewport width the lobby grid collapses to a single column. */
export const SINGLE_COL_BREAKPOINT = 360;
/** From this width the lobby uses 3 columns (tablet portrait / small split view). */
export const THREE_COL_BREAKPOINT = 700;
/** From this width the lobby uses 4 columns (tablet landscape / large windows). */
export const FOUR_COL_BREAKPOINT = 1000;

/**
 * Height (pt) of the icon slot at the top of every lobby tile. The emoji, the Star Swarm
 * image and Cascade's drawn icon are all centred in it; the tile-art work sizes against it.
 */
export const TILE_ICON_ZONE = 68;

/** How many tile columns the lobby shows at a given window width (#4005). */
export function lobbyColumns(width: number): 1 | 2 | 3 | 4 {
  if (width < SINGLE_COL_BREAKPOINT) return 1;
  if (width < THREE_COL_BREAKPOINT) return 2;
  if (width < FOUR_COL_BREAKPOINT) return 3;
  return 4;
}
