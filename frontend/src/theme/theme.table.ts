/**
 * Felt-table colours shared by the card games that sit on a rounded felt
 * (Solitaire #3606, FreeCell #3607). Same green look as the Hearts table.
 *
 * Felt is a table surface, so it keeps its own green in both modes; the light
 * values are a lighter green that still gives the white cards contrast.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`.
 */

/** Felt centre, edge and rim in dark mode. */
export const TABLE_FELT_CENTRE_DARK = "#17342d";
export const TABLE_FELT_EDGE_DARK = "#0f211c";
export const TABLE_FELT_BORDER_DARK = "#22433b";

/** Felt centre, edge and rim in light mode. */
export const TABLE_FELT_CENTRE_LIGHT = "#2c6b57";
export const TABLE_FELT_EDGE_LIGHT = "#20523f";
export const TABLE_FELT_BORDER_LIGHT = "#3c7f69";

/** Empty pile slot on the felt: faint outline, faint fill and the "K" / suit marker. */
export const TABLE_SLOT_EDGE = "rgba(255,255,255,0.16)";
export const TABLE_SLOT_FILL = "rgba(255,255,255,0.04)";
export const TABLE_SLOT_MARK = "rgba(255,255,255,0.3)";
