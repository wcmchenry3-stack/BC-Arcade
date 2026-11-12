/**
 * The Blackjack table's colours (#3580), all theme tokens. One place, so the
 * contrast test (theme/__tests__/blackjackTable.test.ts) checks what the table
 * draws.
 */
import type { Colors, Theme } from "../../theme/ThemeContext";
import {
  BLACKJACK_NATURAL_GOLD,
  BLACKJACK_NATURAL_GOLD_LIGHT,
  BLACKJACK_NATURAL_SILVER,
  BLACKJACK_NATURAL_SILVER_LIGHT,
  BLACKJACK_NATURAL_SWEEP,
  BLACKJACK_NATURAL_SWEEP_LIGHT,
} from "../../theme/theme.constants";

/** The felt. */
export const feltColor = (c: Colors): string => c.surface;

/**
 * Outline drawn around a face-down card (the dealer's hole card). Deck backs
 * come from the deck renderer and can sit close to the felt's colour (the
 * Classic back is `surfaceAlt`), so the table outlines the card itself:
 * at least 3:1 against the felt in both themes.
 */
export const holeCardOutline = (c: Colors): string => c.textMuted;

/** A natural's colours on the felt (#3621): see `BLACKJACK_NATURAL_*` in theme.constants. */
export interface NaturalColors {
  /** The player's edge, and the 3:2 payout chip's rim: at least 3:1 against the felt. */
  readonly gold: string;
  /** The dealer's edge: at least 3:1 against the felt. */
  readonly silver: string;
  /** The light sweep across the felt (drawn at ≤ 0.14 opacity). */
  readonly sweep: string;
}

export const naturalColors = (theme: Theme): NaturalColors =>
  theme === "light"
    ? {
        gold: BLACKJACK_NATURAL_GOLD_LIGHT,
        silver: BLACKJACK_NATURAL_SILVER_LIGHT,
        sweep: BLACKJACK_NATURAL_SWEEP_LIGHT,
      }
    : {
        gold: BLACKJACK_NATURAL_GOLD,
        silver: BLACKJACK_NATURAL_SILVER,
        sweep: BLACKJACK_NATURAL_SWEEP,
      };
