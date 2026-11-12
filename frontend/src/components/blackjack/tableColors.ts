/**
 * The Blackjack table's colours (#3580), all theme tokens. One place, so the
 * contrast test (theme/__tests__/blackjackTable.test.ts) checks what the table
 * draws. The dealer's hole card has no outline of its own: the card back (#3740)
 * holds 3:1 against the felt by itself.
 */
import type { Colors } from "../../theme/ThemeContext";

/** The felt. */
export const feltColor = (c: Colors): string => c.surface;
