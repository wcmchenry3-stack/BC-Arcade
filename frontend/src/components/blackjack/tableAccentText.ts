/**
 * A table's accent as the colour of text (#3755): the light accent reads ~2:1 on the felt, so
 * `colors.accent` becomes `colors.accentText`. The other tables' accents (secondary, tertiary)
 * pass through unchanged. Borders, fills and the progress bar keep the raw accent.
 */
import type { Colors } from "../../theme/ThemeContext";

export const accentAsText = (c: Colors, tableAccent: string): string =>
  tableAccent === c.accent ? c.accentText : tableAccent;
