import React from "react";
import { StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import type { SharedValue } from "react-native-reanimated";

import SharedFoundationPile from "../cards/FoundationPile";
import { HINT_DEST_BORDER } from "../cards/HintFrame";
import type { Colors } from "../../theme/ThemeContext";
import type { DropHandler } from "../../game/_shared/drag/DragContext";
import type { Card, Suit } from "../../game/freecell/types";

export interface FoundationPileProps {
  readonly pile: readonly Card[];
  readonly suit: Suit;
  readonly selected?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly hintDestination?: boolean;
  /** The selected card can move here (#3607): a green outline and "Can move here". */
  readonly legalTarget?: boolean;
  /** Reduce Motion (#3607): the selected card does not lift. The screen reads the setting once. */
  readonly reduceMotion?: boolean;
  readonly onPress?: (suit: Suit) => void;
  readonly dropId?: string;
  readonly onDrop?: DropHandler;
}

const CARD_LABEL_KEYS = { normal: "card.label", selected: "card.selected" } as const;

// On the felt (#3607) the empty pile's suit is a quiet marker, as in Solitaire.
const glyphColor = (_suit: Suit, colors: Colors) => colors.textMuted;

/** FreeCell's foundation: the shared pile (#2983) on the felt (#3607), with FreeCell's look and ids. */
export default function FoundationPile(props: FoundationPileProps) {
  const { t } = useTranslation("freecell");
  return (
    <SharedFoundationPile
      {...props}
      onFelt
      canMoveHereHint={t("pile.canMoveHere")}
      game="freecell"
      ns="freecell"
      testIdPrefix="freecell"
      cardLabelKeys={CARD_LABEL_KEYS}
      emptyRadius={6}
      hintBorderWidth={HINT_DEST_BORDER}
      topCardHint="overlay"
      suitGlyphStyle={styles.suit}
      suitGlyphColor={glyphColor}
    />
  );
}

const styles = StyleSheet.create({
  suit: {
    fontSize: 18,
    lineHeight: 22,
  },
});
