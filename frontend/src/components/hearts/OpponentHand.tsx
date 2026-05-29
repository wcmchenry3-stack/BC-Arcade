import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { Card } from "../../game/hearts/types";
import { cardStr } from "../../game/hearts/debugLog";

interface Props {
  cardCount: number;
  label: string;
  /** "horizontal" = North (portrait cards fanning left-to-right).
   *  "vertical"   = East/West (landscape cards stacked top-to-bottom). */
  layout?: "horizontal" | "vertical";
  /** __DEV__ only: when provided, renders card identities as a text row below the hand. */
  revealCards?: readonly Card[];
}

// Horizontal fan constants (North)
const H_W = 24;
const H_H = 34;
const H_OFFSET = 8;

// Vertical stack constants (East / West) — wider-than-tall to read as sideways
const V_W = 32;
const V_H = 22;
const V_OFFSET = 5;

const cardShadow = {
  shadowColor: "#000",
  shadowOffset: { width: 0, height: 1 },
  shadowOpacity: 0.3,
  shadowRadius: 3,
  elevation: 2,
} as const;

export default function OpponentHand({
  cardCount,
  label,
  layout = "horizontal",
  revealCards,
}: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();

  const count = Math.min(cardCount, 13);
  const faceDownLabel = t("card.faceDown");
  const gradientColors = [colors.accent, colors.secondary] as [string, string];

  if (layout === "vertical") {
    const stackH = count > 0 ? (count - 1) * V_OFFSET + V_H : 0;
    return (
      <View
        style={styles.container}
        accessibilityLabel={t("hand.opponent", { label, count: cardCount })}
        accessibilityRole="none"
      >
        <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
        <View style={{ position: "relative", width: V_W, height: stackH }}>
          {Array.from({ length: count }).map((_, i) => (
            <View
              key={i}
              accessible
              accessibilityLabel={faceDownLabel}
              accessibilityRole="image"
              style={[styles.vertCard, { top: i * V_OFFSET, borderColor: colors.border }]}
            >
              <LinearGradient
                colors={gradientColors}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={StyleSheet.absoluteFillObject}
              />
            </View>
          ))}
        </View>
        {__DEV__ && revealCards && (
          <Text style={[styles.revealText, { color: colors.textMuted }]}>
            {revealCards.map(cardStr).join(" ")}
          </Text>
        )}
      </View>
    );
  }

  // Horizontal fan (North)
  const fanW = count > 0 ? (count - 1) * H_OFFSET + H_W : 0;
  return (
    <View
      style={styles.container}
      accessibilityLabel={t("hand.opponent", { label, count: cardCount })}
      accessibilityRole="none"
    >
      <Text style={[styles.label, { color: colors.textMuted }]}>{label}</Text>
      <View style={{ position: "relative", width: fanW, height: H_H }}>
        {Array.from({ length: count }).map((_, i) => (
          <View
            key={i}
            accessible
            accessibilityLabel={faceDownLabel}
            accessibilityRole="image"
            style={[styles.horizCard, { left: i * H_OFFSET, borderColor: colors.border }]}
          >
            <LinearGradient
              colors={gradientColors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={StyleSheet.absoluteFillObject}
            />
          </View>
        ))}
      </View>
      {__DEV__ && revealCards && (
        <Text style={[styles.revealText, { color: colors.textMuted }]}>
          {revealCards.map(cardStr).join(" ")}
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 4,
  },
  label: {
    fontSize: 12,
    fontWeight: "600",
  },
  horizCard: {
    position: "absolute",
    top: 0,
    width: H_W,
    height: H_H,
    borderRadius: 4,
    borderWidth: 1,
    overflow: "hidden",
    ...cardShadow,
  },
  vertCard: {
    position: "absolute",
    left: 0,
    width: V_W,
    height: V_H,
    borderRadius: 4,
    borderWidth: 1,
    overflow: "hidden",
    ...cardShadow,
  },
  revealText: {
    fontSize: 9,
    flexWrap: "wrap",
    textAlign: "center",
    maxWidth: 80,
    marginTop: 2,
  },
});
