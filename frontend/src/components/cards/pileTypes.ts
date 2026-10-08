import type { CanonicalSuit } from "../../game/_shared/decks/types";

/** The card games that use the shared pile components (`DragSource.game`, i18n namespace). */
export type CardGame = "freecell" | "solitaire";

/** What a shared pile needs from a card. FreeCell cards have no `faceUp`: always face-up. */
export interface PileCard {
  readonly suit: CanonicalSuit;
  readonly rank: number;
  readonly faceUp?: boolean;
}
