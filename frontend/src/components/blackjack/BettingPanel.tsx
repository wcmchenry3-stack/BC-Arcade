import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { GameRules } from "../../game/blackjack/types";
import BettingCircle from "./BettingCircle";
import {
  DECK_COUNT_MAX,
  DECK_COUNT_MIN,
  PENETRATION_MAX,
  PENETRATION_MIN,
  PENETRATION_STEP,
} from "../../game/blackjack/constants";
import ChipButton from "./ChipButton";
import RuleRow from "./RuleRow";
import Stepper from "./Stepper";

interface Props {
  chips: number;
  betMin: number;
  betMax: number;
  chipDenominations: readonly number[];
  accentColor?: string;
  onDeal: (amount: number) => void;
  loading: boolean;
  error: string | null;
  rules: GameRules;
  onRulesChange: (rules: GameRules) => void;
}

export default function BettingPanel({
  chips,
  betMin,
  betMax,
  chipDenominations,
  accentColor,
  onDeal,
  loading,
  error,
  rules,
  onRulesChange,
}: Props) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const maxBet = Math.min(betMax, chips);
  const effectiveMin = Math.min(betMin, chips);
  const effectiveDenominations = chips < betMin ? [chips] : chipDenominations;
  const [bet, setBet] = useState<number>(0);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<"soft17" | "decks" | "penetration" | null>(
    null
  );

  function toggleTooltip(key: "soft17" | "decks" | "penetration") {
    setActiveTooltip((prev) => (prev === key ? null : key));
  }

  function setDeckCount(n: number) {
    onRulesChange({
      ...rules,
      deck_count: Math.min(DECK_COUNT_MAX, Math.max(DECK_COUNT_MIN, n)),
    });
  }

  function setPenetration(p: number) {
    const rounded = Math.round(p * 100) / 100;
    onRulesChange({
      ...rules,
      penetration: Math.min(PENETRATION_MAX, Math.max(PENETRATION_MIN, rounded)),
    });
  }

  function addChip(denomination: number) {
    setBet((b) => Math.min(maxBet, b + denomination));
  }

  function clearBet() {
    setBet(0);
  }

  const canDeal = bet >= effectiveMin && bet <= maxBet && !loading;
  const resolvedAccent = accentColor ?? colors.accent;

  const chipColors = [colors.accent, colors.secondary, colors.tertiary, colors.secondary] as const;
  const chipTextColors = [
    colors.textOnAccent,
    colors.textOnAccent,
    colors.textOnAccent,
    colors.textOnAccent,
  ] as const;

  return (
    <View style={styles.container}>
      {/* Betting circle */}
      <BettingCircle bet={bet} accentColor={resolvedAccent} />

      {/* Chip denomination row */}
      <View style={styles.chipRow}>
        {effectiveDenominations.map((denom, i) => (
          <ChipButton
            key={denom}
            amount={denom}
            onPress={() => addChip(denom)}
            disabled={bet + denom > maxBet || loading}
            chipColor={chipColors[i] ?? colors.accent}
            textColor={chipTextColors[i] ?? colors.textOnAccent}
          />
        ))}
      </View>

      {/* Table limits */}
      <Text style={[styles.limits, { color: colors.textMuted, fontFamily: typography.label }]}>
        {t("betting.tableLimits")}: {t("betting.tableLimitsRange", { min: betMin, max: betMax })}
      </Text>

      {/* Action buttons */}
      <View style={styles.actions}>
        <Pressable
          style={[
            styles.clearBtn,
            { borderColor: colors.error, opacity: bet === 0 || loading ? 0.4 : 1 },
          ]}
          onPress={clearBet}
          disabled={bet === 0 || loading}
          accessibilityRole="button"
          accessibilityLabel={t("betting.clearBetLabel")}
          accessibilityState={{ disabled: bet === 0 || loading }}
        >
          <Text
            style={[styles.clearBtnText, { color: colors.error, fontFamily: typography.label }]}
          >
            {t("betting.clearBet")}
          </Text>
        </Pressable>

        <Pressable
          testID="blackjack-deal-button"
          style={[styles.dealBtn, { backgroundColor: canDeal ? resolvedAccent : colors.border }]}
          onPress={() => onDeal(bet)}
          disabled={!canDeal}
          accessibilityRole="button"
          accessibilityLabel={t("actions.dealLabel", { amount: bet })}
          accessibilityState={{ disabled: !canDeal, busy: loading }}
        >
          <Text
            style={[
              styles.dealBtnText,
              {
                color: canDeal ? colors.textOnAccent : colors.textMuted,
                fontFamily: typography.label,
              },
            ]}
          >
            {t("actions.deal")}
          </Text>
        </Pressable>
      </View>

      {/* Collapsible Table Rules */}
      <Pressable
        style={styles.rulesToggle}
        onPress={() => {
          setRulesOpen((o) => !o);
          setActiveTooltip(null);
        }}
        accessibilityRole="button"
        accessibilityLabel={t("rules.toggleLabel")}
      >
        <Text style={[styles.rulesToggleText, { color: colors.textMuted }]}>
          {rulesOpen ? "▾" : "▸"} {t("rules.title")}
        </Text>
      </Pressable>

      {rulesOpen && (
        <View style={[styles.rulesPanel, { borderColor: colors.border }]}>
          <RuleRow
            label={t("rules.dealerSoft17")}
            tooltipLabel={t("rules.soft17TooltipLabel")}
            tooltip={t("rules.soft17Tooltip")}
            expanded={activeTooltip === "soft17"}
            onToggleTooltip={() => toggleTooltip("soft17")}
          >
            <View style={styles.ruleOptions}>
              {[
                { hit: false, label: t("rules.s17"), a11y: t("rules.s17Label") },
                { hit: true, label: t("rules.h17"), a11y: t("rules.h17Label") },
              ].map(({ hit, label, a11y }) => {
                const selected = rules.hit_soft_17 === hit;
                return (
                  <Pressable
                    key={String(hit)}
                    style={[
                      styles.ruleOptionBtn,
                      {
                        backgroundColor: selected ? colors.accent : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => onRulesChange({ ...rules, hit_soft_17: hit })}
                    accessibilityRole="button"
                    accessibilityLabel={a11y}
                  >
                    <Text
                      style={[
                        styles.ruleOptionText,
                        { color: selected ? colors.textOnAccent : colors.text },
                      ]}
                    >
                      {label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </RuleRow>

          <RuleRow
            label={t("rules.deckCount")}
            tooltipLabel={t("rules.decksTooltipLabel")}
            tooltip={t("rules.decksTooltip")}
            expanded={activeTooltip === "decks"}
            onToggleTooltip={() => toggleTooltip("decks")}
          >
            <Stepper
              value={String(rules.deck_count)}
              onDecrement={() => setDeckCount(rules.deck_count - 1)}
              onIncrement={() => setDeckCount(rules.deck_count + 1)}
              decrementDisabled={rules.deck_count <= DECK_COUNT_MIN}
              incrementDisabled={rules.deck_count >= DECK_COUNT_MAX}
              decrementLabel={t("rules.decreaseDeckLabel")}
              incrementLabel={t("rules.increaseDeckLabel")}
            />
          </RuleRow>

          <RuleRow
            label={t("rules.penetration")}
            tooltipLabel={t("rules.penetrationTooltipLabel")}
            tooltip={t("rules.penetrationTooltip")}
            expanded={activeTooltip === "penetration"}
            onToggleTooltip={() => toggleTooltip("penetration")}
          >
            <Stepper
              value={`${Math.round(rules.penetration * 100)}%`}
              onDecrement={() => setPenetration(rules.penetration - PENETRATION_STEP)}
              onIncrement={() => setPenetration(rules.penetration + PENETRATION_STEP)}
              decrementDisabled={rules.penetration <= PENETRATION_MIN}
              incrementDisabled={rules.penetration >= PENETRATION_MAX}
              decrementLabel={t("rules.decreasePenetrationLabel")}
              incrementLabel={t("rules.increasePenetrationLabel")}
            />
          </RuleRow>
        </View>
      )}

      {error ? <Text style={[styles.error, { color: colors.error }]}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 16,
    width: "100%",
    maxWidth: 360,
  },
  chipRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 12,
  },
  limits: {
    fontSize: 11,
    textTransform: "uppercase",
    letterSpacing: 0.6,
  },
  actions: {
    flexDirection: "row",
    gap: 12,
    width: "100%",
    maxWidth: 320,
  },
  clearBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 1,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  clearBtnText: {
    fontSize: 15,
  },
  dealBtn: {
    flex: 2,
    paddingVertical: 14,
    borderRadius: 12,
    minHeight: 48,
    alignItems: "center",
    justifyContent: "center",
  },
  dealBtnText: {
    fontSize: 17,
  },
  error: {
    fontSize: 13,
    textAlign: "center",
  },
  rulesToggle: {
    paddingVertical: 4,
  },
  rulesToggleText: {
    fontSize: 13,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  rulesPanel: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  ruleOptions: {
    flexDirection: "row",
    gap: 6,
  },
  ruleOptionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  ruleOptionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
