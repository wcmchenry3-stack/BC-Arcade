import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { rankLabel, suitEmoji, RED_SUITS } from "../cardId";
import { compactMinimalLayout } from "../cornerIndex";
import type { CardFaceProps } from "../types";

export default function MinimalCardFace({
  suit,
  rank,
  faceDown,
  width,
  height,
  cardBg,
  cardBgBack,
  border,
  textColor,
  redSuitColor,
  compactIndex,
}: CardFaceProps) {
  if (faceDown) {
    return (
      <View
        style={[styles.card, { width, height, backgroundColor: cardBgBack, borderColor: border }]}
      >
        <View style={[styles.backInner, { borderColor: border }]}>
          <Text style={[styles.backMark, { color: border }]}>?</Text>
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
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  backInner: {
    width: "70%",
    height: "70%",
    borderRadius: 4,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  backMark: { fontSize: 22, fontWeight: "700" },
  rank: { fontSize: 16, fontWeight: "700", lineHeight: 20 },
  suit: { fontSize: 18, lineHeight: 22 },
  compactRow: { position: "absolute", flexDirection: "row", gap: 1 },
  compactRank: { fontWeight: "700" },
});
