/**
 * The Blackjack table's colours (#3580), all theme tokens. One place, so the
 * contrast test (theme/__tests__/blackjackTable.test.ts) checks what the table
 * draws.
 */
import type { Colors } from "../../theme/ThemeContext";

/** The felt. */
export const feltColor = (c: Colors): string => c.surface;

/**
 * Outline drawn around a face-down card (the dealer's hole card). Deck backs
 * come from the deck renderer and can sit close to the felt's colour (the
 * Classic back is `surfaceAlt`), so the table outlines the card itself:
 * at least 3:1 against the felt in both themes.
 */
export const holeCardOutline = (c: Colors): string => c.textMuted;
