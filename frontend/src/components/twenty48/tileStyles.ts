import { TextStyle, ViewStyle } from "react-native";
import {
  TWENTY48_GLOW_FROM,
  TWENTY48_MAX_TILE,
  TWENTY48_TILES,
  TWENTY48_TOP_TILE_GLOW,
} from "../../theme/theme.twenty48";

export interface TileVisual {
  container: ViewStyle;
  text: TextStyle;
}

/** Digit width as a share of the font size, with room for the heading face's widest digit. */
const DIGIT_WIDTH_EM = 0.62;
/** The tallest a number gets, as a share of the tile: a one-digit tile still leaves a margin. */
const MAX_FONT_OF_TILE = 0.45;
/** The side padding kept clear of the number, as a share of the tile. */
const SIDE_PAD_OF_TILE = 0.1;
/** Never smaller than this, so even a 6-digit number on a small board stays legible. */
const MIN_FONT_SIZE = 10;

/**
 * The number's font size, from the tile's size and the digit count (#3688): as large as fits
 * the tile's width with a margin, capped at 45% of the tile's height, so 2 and 131072 each fill
 * their tile the same way on any screen.
 */
export function getTileFontSize(value: number, tileSize: number): number {
  const digits = String(Math.max(0, Math.trunc(value))).length;
  const width = tileSize * (1 - 2 * SIDE_PAD_OF_TILE);
  const fit = width / (digits * DIGIT_WIDTH_EM);
  return Math.max(MIN_FONT_SIZE, Math.floor(Math.min(tileSize * MAX_FONT_OF_TILE, fit)));
}

/** A tile's flat fill and text colour; 2048 and above get a gold ring and a glow. */
export function getTileVisual(value: number): TileVisual {
  const colors = TWENTY48_TILES[Math.min(value, TWENTY48_MAX_TILE)] ?? TWENTY48_TILES[2];
  const base: TileVisual = {
    container: { backgroundColor: colors?.bg },
    text: { color: colors?.text },
  };
  if (value < TWENTY48_GLOW_FROM) return base;
  return {
    ...base,
    container: {
      ...base.container,
      borderWidth: 2,
      borderColor: TWENTY48_TOP_TILE_GLOW,
      shadowColor: TWENTY48_TOP_TILE_GLOW,
      shadowOpacity: 0.9,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 0 },
      elevation: 10,
    },
  };
}
