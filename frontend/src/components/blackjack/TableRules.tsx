/**
 * TableRules — the collapsible "Table Rules" section (dealer soft 17, decks,
 * penetration), shown on the felt while betting (#3580; formerly part of
 * BettingPanel). Rules can only change between hands.
 */
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { GameRules } from "../../game/blackjack/types";
import {
  DECK_COUNT_MAX,
  DECK_COUNT_MIN,
  PENETRATION_MAX,
  PENETRATION_MIN,
  PENETRATION_STEP,
} from "../../game/blackjack/constants";
import RuleRow from "./RuleRow";
import Stepper from "./Stepper";

interface Props {
  rules: GameRules;
  onRulesChange: (rules: GameRules) => void;
}

type Tooltip = "soft17" | "decks" | "penetration";

export default function TableRules({ rules, onRulesChange }: Props) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<Tooltip | null>(null);

  const toggleTooltip = (key: Tooltip) => setActiveTooltip((prev) => (prev === key ? null : key));

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

  return (
    <View style={styles.container}>
      {open && (
        <View
          style={[
            styles.panel,
            { borderColor: colors.border, backgroundColor: colors.surfaceHigh },
          ]}
        >
          <RuleRow
            label={t("rules.dealerSoft17")}
            tooltipLabel={t("rules.soft17TooltipLabel")}
            tooltip={t("rules.soft17Tooltip")}
            expanded={activeTooltip === "soft17"}
            onToggleTooltip={() => toggleTooltip("soft17")}
          >
            <View style={styles.options}>
              {[
                { hit: false, label: t("rules.s17"), a11y: t("rules.s17Label") },
                { hit: true, label: t("rules.h17"), a11y: t("rules.h17Label") },
              ].map(({ hit, label, a11y }) => {
                const selected = rules.hit_soft_17 === hit;
                return (
                  <Pressable
                    key={String(hit)}
                    style={[
                      styles.optionBtn,
                      {
                        backgroundColor: selected ? colors.accent : colors.surface,
                        borderColor: colors.border,
                      },
                    ]}
                    onPress={() => onRulesChange({ ...rules, hit_soft_17: hit })}
                    accessibilityRole="button"
                    accessibilityLabel={a11y}
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.optionText,
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

      <Pressable
        style={styles.toggle}
        onPress={() => {
          setOpen((o) => !o);
          setActiveTooltip(null);
        }}
        accessibilityRole="button"
        accessibilityLabel={t("rules.toggleLabel")}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
      >
        <Text style={[styles.toggleText, { color: colors.textMuted }]}>
          {open ? "▾" : "▸"} {t("rules.title")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 6,
    width: "100%",
  },
  toggle: {
    paddingVertical: 4,
  },
  toggleText: {
    fontSize: 12,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  panel: {
    width: "100%",
    borderWidth: 1,
    borderRadius: 10,
    padding: 12,
    gap: 12,
  },
  options: {
    flexDirection: "row",
    gap: 6,
  },
  optionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
  },
  optionText: {
    fontSize: 13,
    fontWeight: "600",
  },
});
