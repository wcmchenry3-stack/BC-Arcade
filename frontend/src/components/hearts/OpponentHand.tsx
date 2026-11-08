import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import PlayingCard from "./PlayingCard";
import { computeHeartsGeometry, fanWithCount, type FanGeometry } from "../../game/hearts/layout";
import type { Card } from "../../game/hearts/types";
import { rankLabel, suitEmoji } from "../../game/_shared/decks/cardId";
import type { CanonicalSuit } from "../../game/_shared/decks/types";
import { sortHand } from "./cardSort";

/** The deck's back, drawn as a face-down card; its face is never shown. */
const BACK_FACE: Card = { suit: "spades", rank: 1 };

const DEFAULT_FAN = computeHeartsGeometry({ width: 390, height: 708 }).fans.top;

interface Props {
  cardCount: number;
  label: string;
  /** Where the fan sits on the table and how it is drawn (default: the north fan of a phone). */
  fan?: FanGeometry;
  /** __DEV__ only: when provided, renders card identities as a text row below the hand. */
  revealCards?: readonly Card[];
}

/**
 * An opponent's hand as a small fan of card backs by their plate (#3587). The fan is
 * decorative (at most four backs, however many cards are left); the count is in its label.
 * The backs are the active deck's, so every deck draws its own.
 */
export default function OpponentHand({ cardCount, label, fan = DEFAULT_FAN, revealCards }: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  // Fewer than four cards left: a smaller fan, centred, not the first slots of the full one.
  const cards = fanWithCount(fan, Math.min(Math.max(cardCount, 0), fan.cards.length)).cards;

  return (
    <View
      style={[
        styles.container,
        { left: fan.rect.x, top: fan.rect.y, width: fan.rect.w, height: fan.rect.h },
      ]}
      // One accessible node with the real count: the backs are decorative (at most four), and
      // TalkBack skips a plain View's label unless it is accessible (Codex review of #3608).
      accessible
      accessibilityLabel={t("hand.opponent", { label, count: cardCount })}
      accessibilityRole="none"
    >
      {cards.map((c, i) => (
        <View
          key={i}
          pointerEvents="none"
          style={[styles.back, { left: c.x - fan.rect.x, top: c.y - fan.rect.y }]}
        >
          <PlayingCard
            card={BACK_FACE}
            faceDown
            width={fan.cardW}
            height={fan.cardH}
            rotation={c.rotation}
          />
        </View>
      ))}
      {__DEV__ && revealCards && (
        <Text style={[styles.revealText, { color: colors.textMuted, top: fan.rect.h }]}>
          {sortHand(revealCards)
            .map((c) => `${rankLabel(c.rank)}${suitEmoji(c.suit as CanonicalSuit)}`)
            .join(" ")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
  },
  back: {
    position: "absolute",
  },
  revealText: {
    position: "absolute",
    fontSize: 9,
    width: 80,
    textAlign: "center",
  },
});
