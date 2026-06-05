import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { HandResponse } from "../../game/blackjack/types";
import HandDisplay from "./HandDisplay";

interface Props {
  playerHand: HandResponse;
  dealerHand: HandResponse;
  phase: string;
  /** All player hands when split is active. */
  playerHands?: HandResponse[];
  /** Index of the hand currently being played. */
  activeHandIndex?: number;
  /** Per-hand bets (when split). */
  handBets?: number[];
  /** Per-hand outcomes (when split, in result phase). */
  handOutcomes?: (string | null)[];
  /** Shrink card sizes and table padding on short-height viewports. */
  compact?: boolean;
}

export default function BlackjackTable({
  playerHand,
  dealerHand,
  phase,
  playerHands,
  activeHandIndex = 0,
  handBets,
  handOutcomes,
  compact = false,
}: Props) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const isPlayerPhase = phase === "player";
  const isSplit = playerHands && playerHands.length > 1;

  return (
    <View style={[styles.container, compact && styles.containerCompact]}>
      <View style={styles.dealerArea}>
        <HandDisplay
          hand={dealerHand}
          label={t("hand.dealer")}
          concealed={isPlayerPhase}
          variant="dealer"
          compact={compact}
          maxPerRow={5}
        />
      </View>
      <View style={[styles.divider, { backgroundColor: colors.border }]} />

      {isSplit ? (
        <View style={styles.handsRow}>
          {playerHands.map((hand, i) => {
            const isActive = isPlayerPhase && i === activeHandIndex;
            const bet = handBets?.[i];
            const outcome = handOutcomes?.[i];
            const label = t("hand.playerHand", { number: i + 1 });

            return (
              <View
                key={i}
                style={[
                  styles.splitHand,
                  isActive && {
                    borderColor: colors.accent,
                    borderWidth: 2,
                    shadowColor: colors.accent,
                    shadowOpacity: 0.4,
                    shadowRadius: 8,
                    elevation: 4,
                  },
                ]}
              >
                <HandDisplay hand={hand} label={label} variant="player" compact maxPerRow={3} />
                {bet != null && phase !== "result" && (
                  <Text style={[styles.handBet, { color: colors.textMuted }]}>{bet}</Text>
                )}
                {isActive && (
                  <Text style={[styles.activeLabel, { color: colors.accent }]}>
                    {t("hand.activeIndicator")}
                  </Text>
                )}
              </View>
            );
          })}
        </View>
      ) : (
        <View style={styles.playerArea}>
          <HandDisplay
            hand={playerHand}
            label={t("hand.player")}
            variant="player"
            compact={compact}
            maxPerRow={5}
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    gap: 8,
    width: "100%",
    paddingVertical: 8,
  },
  containerCompact: {
    gap: 4,
    paddingVertical: 4,
  },
  dealerArea: {
    alignItems: "center",
  },
  playerArea: {
    alignItems: "center",
  },
  divider: {
    width: "60%",
    height: 1,
    opacity: 0.4,
  },
  handsRow: {
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "flex-start",
    width: "100%",
    gap: 8,
  },
  splitHand: {
    flex: 1,
    alignItems: "center",
    padding: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "transparent",
    gap: 4,
  },
  handBet: {
    fontSize: 12,
    fontWeight: "600",
  },
  activeLabel: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
  },
});
