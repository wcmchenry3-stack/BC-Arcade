import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";
import { GameRules } from "../../game/blackjack/types";
import BettingCircle from "./BettingCircle";
import ChipButton from "./ChipButton";

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
        onPress={() => setRulesOpen((o) => !o)}
        accessibilityRole="button"
        accessibilityLabel={t("rules.toggleLabel")}
      >
        <Text style={[styles.rulesToggleText, { color: colors.textMuted }]}>
          {rulesOpen ? "▾" : "▸"} {t("rules.title")}
        </Text>
      </Pressable>

      {rulesOpen && (
        <View style={[styles.rulesPanel, { borderColor: colors.border }]}>
          {/* H17 toggle */}
          <View style={styles.ruleSection}>
            <View style={styles.ruleRow}>
              <View style={styles.ruleLabelRow}>
                <Text style={[styles.ruleLabel, { color: colors.text }]}>
                  {t("rules.dealerSoft17")}
                </Text>
                <Pressable
                  onPress={() => toggleTooltip("soft17")}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.soft17TooltipLabel")}
                  hitSlop={8}
                >
                  <Text style={[styles.tooltipIcon, { color: colors.textMuted }]}>ⓘ</Text>
                </Pressable>
              </View>
              <View style={styles.ruleOptions}>
                <Pressable
                  style={[
                    styles.ruleOptionBtn,
                    {
                      backgroundColor: !rules.hit_soft_17 ? colors.accent : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => onRulesChange({ ...rules, hit_soft_17: false })}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.s17Label")}
                >
                  <Text
                    style={[
                      styles.ruleOptionText,
                      { color: !rules.hit_soft_17 ? colors.textOnAccent : colors.text },
                    ]}
                  >
                    {t("rules.s17")}
                  </Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.ruleOptionBtn,
                    {
                      backgroundColor: rules.hit_soft_17 ? colors.accent : colors.surface,
                      borderColor: colors.border,
                    },
                  ]}
                  onPress={() => onRulesChange({ ...rules, hit_soft_17: true })}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.h17Label")}
                >
                  <Text
                    style={[
                      styles.ruleOptionText,
                      { color: rules.hit_soft_17 ? colors.textOnAccent : colors.text },
                    ]}
                  >
                    {t("rules.h17")}
                  </Text>
                </Pressable>
              </View>
            </View>
            {activeTooltip === "soft17" && (
              <Text style={[styles.tooltipText, { color: colors.textMuted }]}>
                {t("rules.soft17Tooltip")}
              </Text>
            )}
          </View>

          {/* Deck count */}
          <View style={styles.ruleSection}>
            <View style={styles.ruleRow}>
              <View style={styles.ruleLabelRow}>
                <Text style={[styles.ruleLabel, { color: colors.text }]}>
                  {t("rules.deckCount")}
                </Text>
                <Pressable
                  onPress={() => toggleTooltip("decks")}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.decksTooltipLabel")}
                  hitSlop={8}
                >
                  <Text style={[styles.tooltipIcon, { color: colors.textMuted }]}>ⓘ</Text>
                </Pressable>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  style={[
                    styles.ruleStepBtn,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() =>
                    onRulesChange({ ...rules, deck_count: Math.max(1, rules.deck_count - 1) })
                  }
                  disabled={rules.deck_count <= 1}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.decreaseDeckLabel")}
                >
                  <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
                </Pressable>
                <Text style={[styles.ruleValue, { color: colors.text }]}>{rules.deck_count}</Text>
                <Pressable
                  style={[
                    styles.ruleStepBtn,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() =>
                    onRulesChange({ ...rules, deck_count: Math.min(8, rules.deck_count + 1) })
                  }
                  disabled={rules.deck_count >= 8}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.increaseDeckLabel")}
                >
                  <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
                </Pressable>
              </View>
            </View>
            {activeTooltip === "decks" && (
              <Text style={[styles.tooltipText, { color: colors.textMuted }]}>
                {t("rules.decksTooltip")}
              </Text>
            )}
          </View>

          {/* Penetration */}
          <View style={styles.ruleSection}>
            <View style={styles.ruleRow}>
              <View style={styles.ruleLabelRow}>
                <Text style={[styles.ruleLabel, { color: colors.text }]}>
                  {t("rules.penetration")}
                </Text>
                <Pressable
                  onPress={() => toggleTooltip("penetration")}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.penetrationTooltipLabel")}
                  hitSlop={8}
                >
                  <Text style={[styles.tooltipIcon, { color: colors.textMuted }]}>ⓘ</Text>
                </Pressable>
              </View>
              <View style={styles.stepper}>
                <Pressable
                  style={[
                    styles.ruleStepBtn,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() =>
                    onRulesChange({
                      ...rules,
                      penetration: Math.max(
                        0.5,
                        Math.round((rules.penetration - 0.05) * 100) / 100
                      ),
                    })
                  }
                  disabled={rules.penetration <= 0.5}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.decreasePenetrationLabel")}
                >
                  <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
                </Pressable>
                <Text style={[styles.ruleValue, { color: colors.text }]}>
                  {Math.round(rules.penetration * 100)}%
                </Text>
                <Pressable
                  style={[
                    styles.ruleStepBtn,
                    { backgroundColor: colors.surface, borderColor: colors.border },
                  ]}
                  onPress={() =>
                    onRulesChange({
                      ...rules,
                      penetration: Math.min(
                        0.9,
                        Math.round((rules.penetration + 0.05) * 100) / 100
                      ),
                    })
                  }
                  disabled={rules.penetration >= 0.9}
                  accessibilityRole="button"
                  accessibilityLabel={t("rules.increasePenetrationLabel")}
                >
                  <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
                </Pressable>
              </View>
            </View>
            {activeTooltip === "penetration" && (
              <Text style={[styles.tooltipText, { color: colors.textMuted }]}>
                {t("rules.penetrationTooltip")}
              </Text>
            )}
          </View>
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
  ruleSection: {
    gap: 6,
  },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  ruleLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    flex: 1,
  },
  ruleLabel: {
    fontSize: 13,
    fontWeight: "500",
  },
  tooltipIcon: {
    fontSize: 13,
  },
  tooltipText: {
    fontSize: 12,
    lineHeight: 17,
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
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  ruleStepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  stepBtnText: {
    fontSize: 18,
    lineHeight: 22,
    fontWeight: "600",
  },
  ruleValue: {
    fontSize: 15,
    fontWeight: "700",
    minWidth: 44,
    textAlign: "center",
  },
});
