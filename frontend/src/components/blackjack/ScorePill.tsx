import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

interface Props {
  /** Numeric hand value. */
  value: number;
  /** True when Ace is counted as 11 (soft hand). */
  soft?: boolean;
  /** True when dealer hole card is hidden — shows "?" instead of value. */
  concealed?: boolean;
  /** "player" renders the large neon-glow pill; "dealer" renders the compact glass badge. */
  variant: "player" | "dealer";
}

export default function ScorePill({ value, soft = false, concealed = false, variant }: Props) {
  const { colors } = useTheme();
  const label = concealed ? "?" : soft ? `${value}*` : String(value);

  if (variant === "dealer") {
    return (
      <View
        style={[
          styles.dealerBadge,
          { backgroundColor: colors.text, borderColor: colors.text },
        ]}
        accessibilityLabel={concealed ? "Dealer score hidden" : `Dealer score ${label}`}
      >
        <Text style={[styles.dealerText, { color: colors.surface }]}>{label}</Text>
      </View>
    );
  }

  // Player: neon-glow pill — gradient border ring + inner surface + large bold text
  return (
    <View
      style={[styles.playerGlow, { shadowColor: colors.accent }]}
      accessibilityLabel={`Player score ${label}`}
    >
      {/* Gradient ring approximated with a cyan-tinted outer view */}
      <View style={[styles.playerRing, { backgroundColor: colors.accent }]}>
        <View
          style={[
            styles.playerInner,
            { backgroundColor: colors.surface, borderColor: colors.accent },
          ]}
        >
          <Text style={[styles.playerText, { color: colors.accent }]}>{label}</Text>
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  dealerBadge: {
    paddingHorizontal: 20,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  dealerText: {
    fontSize: 18,
    fontWeight: "700",
  },
  // Player pill
  playerGlow: {
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.35,
    shadowRadius: 16,
    elevation: 8,
  },
  playerRing: {
    borderRadius: 24,
    padding: 2,
  },
  playerInner: {
    paddingHorizontal: 28,
    paddingVertical: 6,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
  },
  playerText: {
    fontSize: 32,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
});
