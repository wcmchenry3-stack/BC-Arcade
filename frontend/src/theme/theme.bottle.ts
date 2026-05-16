/**
 * Bottle game design tokens.
 *
 * Matches the design-tokens policy skip pattern `theme\.[^./]+\.[jt]sx?$`,
 * which lets us keep raw color literals here instead of inlining them in
 * component files.
 */

import type { Theme } from "./ThemeContext";
import type { Color } from "../game/sort/types";

/** Liquid colors per theme, validated: ΔE₂₀₀₀ ≥ 20 for all 91 pairs, contrast ≥ 3:1 vs bg. */
export const BOTTLE_LIQUID_COLORS: Record<Theme, Record<Color, string>> = {
  dark: {
    red:    "#ff7777",
    orange: "#ff8800",
    brown:  "#aa5533",
    gold:   "#886600",
    yellow: "#ffee00",
    lime:   "#66ff00",
    green:  "#008844",
    teal:   "#00ddcc",
    navy:   "#22aadd",
    blue:   "#3366dd",
    indigo: "#cc99ff",
    purple: "#aa00dd",
    pink:   "#ff33bb",
    maroon: "#cc0055",
  },
  light: {
    maroon: "#770033",
    red:    "#dd0033",
    brown:  "#662200",
    orange: "#bb5500",
    gold:   "#554400",
    yellow: "#998800",
    lime:   "#336600",
    green:  "#009977",
    teal:   "#004444",
    navy:   "#228899",
    blue:   "#1166aa",
    indigo: "#8866ee",
    purple: "#330044",
    pink:   "#cc0088",
  },
};

/** Bottle stroke color when selected (teal highlight). */
export const BOTTLE_STROKE_SELECTED = "#8ff5ff";

/** Bottle stroke color when solved (green). */
export const BOTTLE_STROKE_SOLVED = "#22c55e";

/** Bottle stroke color in default state (dark gray). */
export const BOTTLE_STROKE_DEFAULT = "#4a4a56";

/** Bottle body fill when selected (teal with transparency). */
export const BOTTLE_BODY_FILL_SELECTED = "#8ff5ff22";

/** Bottle body fill in default state (white with low opacity). */
export const BOTTLE_BODY_FILL_DEFAULT = "#ffffff0f";

/** White base used for glass gloss gradient stops (opacity applied via stopOpacity). */
export const BOTTLE_GLOSS_HIGHLIGHT = "#ffffff";

/** Black base used for glass gloss shadow gradient stop (opacity applied via stopOpacity). */
export const BOTTLE_GLOSS_SHADOW = "#000000";

/** Fill for the thin gloss stripe at the top of each liquid band (20% white). */
export const BOTTLE_LIQUID_GLOSS_FILL = "rgba(255,255,255,0.2)";

/** Checkmark badge background when bottle is solved. */
export const BOTTLE_CHECKMARK_BG = "#22c55e";

/** Checkmark badge stroke color. */
export const BOTTLE_CHECKMARK_STROKE = "#0e0e13";

/** Colorblind mode symbol text color. */
export const BOTTLE_COLORBLIND_TEXT = "rgba(0,0,0,0.65)";
