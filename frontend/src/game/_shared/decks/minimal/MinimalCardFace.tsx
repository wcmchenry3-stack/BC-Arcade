import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { rankLabel, suitEmoji, RED_SUITS } from "../cardId";
import { compactMinimalLayout } from "../cornerIndex";
import { backFrameMetrics } from "../cardBackShapes";
import type { CardFaceProps } from "../types";

const CARD_RADIUS = 8;

export default function MinimalCardFace({
  suit,
  rank,
  faceDown,
  width,
  height,
  cardBg,
  cardBgBack,
  cardBackInk,
  border,
  textColor,
  redSuitColor,
  compactIndex,
}: CardFaceProps) {
  if (faceDown) {
    // The frame-only back (#3740): a margin, the field and an inset line, no pattern.
    const { margin, fieldRadius, inset, lineWidth } = backFrameMetrics(width, CARD_RADIUS);
    return (
      <View
        testID="minimal-back"
        style={[styles.card, { width, height, backgroundColor: cardBg, borderColor: border }]}
      >
        <View
          testID="minimal-back-field"
          style={[
            styles.backField,
            {
              top: margin - 1,
              left: margin - 1,
              right: margin - 1,
              bottom: margin - 1,
              borderRadius: fieldRadius,
              backgroundColor: cardBgBack,
            },
          ]}
        >
          <View
            testID="minimal-back-line"
            style={[
              styles.backLine,
              {
                top: inset,
                left: inset,
                right: inset,
                bottom: inset,
                borderRadius: Math.max(1, fieldRadius - inset * 0.5),
                borderWidth: lineWidth,
                borderColor: cardBackInk ?? cardBg,
              },
            ]}
          />
        </View>
      </View>
    );
  }

  const isRed = RED_SUITS.has(suit);
  const color = isRed ? redSuitColor : textColor;

  if (compactIndex !== undefined) {
    // A covered card in a compressed column (#3622): rank and suit on one line in the
    // top-left corner, inside the visible stripe. The rest of the card is under the next one.
    const c = compactMinimalLayout(compactIndex);
    const text = { color, fontSize: c.fontSize, lineHeight: c.lineHeight };
    return (
      <View style={[styles.card, { width, height, backgroundColor: cardBg, borderColor: border }]}>
        <View style={[styles.compactRow, { top: c.top, left: c.left }]}>
          <Text style={[styles.compactRank, text]}>{rankLabel(rank)}</Text>
          <Text style={text}>{suitEmoji(suit)}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.card, { width, height, backgroundColor: cardBg, borderColor: border }]}>
      <Text style={[styles.rank, { color }]}>{rankLabel(rank)}</Text>
      <Text style={[styles.suit, { color }]}>{suitEmoji(suit)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: CARD_RADIUS,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  backField: { position: "absolute" },
  backLine: { position: "absolute" },
  rank: { fontSize: 16, fontWeight: "700", lineHeight: 20 },
  suit: { fontSize: 18, lineHeight: 22 },
  compactRow: { position: "absolute", flexDirection: "row", gap: 1 },
  compactRank: { fontWeight: "700" },
});
