/**
 * A table's accent as the colour of text (#3755, #3819): in light the accent reads ~2:1 on the
 * felt, the lime tertiary ~2.5:1 and the purple secondary 3.6-4.4:1, so each becomes its text-safe
 * token (`accentText`, `tertiaryText`, `secondaryText`). In dark each token is the accent itself.
 * Any other colour passes through. Borders, fills and the progress bar keep the raw accent.
 */
import type { Colors } from "../../theme/ThemeContext";

export const accentAsText = (c: Colors, tableAccent: string): string => {
  if (tableAccent === c.accent) return c.accentText;
  if (tableAccent === c.secondary) return c.secondaryText;
  if (tableAccent === c.tertiary) return c.tertiaryText;
  return tableAccent;
};

/**
 * The label on a table-accent fill (#3819): in light, white on the purple secondary (`textOnAccent`
 * is 4.1:1 there); `textOnAccent` on every other accent and in all of dark, as before.
 */
export const labelOnFill = (c: Colors, theme: "dark" | "light", fill: string): string =>
  theme === "light" && fill === c.secondary ? c.textOnSecondary : c.textOnAccent;
