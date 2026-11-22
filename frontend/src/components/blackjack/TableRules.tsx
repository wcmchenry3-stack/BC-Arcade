/**
 * TableRules — the "Table Rules" toggle on the felt while betting, and the
 * rules (dealer soft 17, decks, penetration, and the fixed standard rules,
 * #3741) in a scrollable bottom sheet
 * (#3580; formerly part of BettingPanel). Collapsed, it is one line at the
 * felt's foot; opened, the sheet scrolls, so every rule and tooltip is
 * reachable on the shortest screens and nothing on the felt is covered.
 * Rules can only change between hands.
 */
import React, { useState } from "react";
import { View, Text, Pressable, ScrollView, Modal, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
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
import RuleRow, { ruleRowStyles } from "./RuleRow";
import Stepper from "./Stepper";

interface Props {
  rules: GameRules;
  onRulesChange: (rules: GameRules) => void;
}

type Tooltip = "soft17" | "decks" | "penetration";

/** S17 / H17: whether the dealer hits a soft 17. */
function Soft17Options({ rules, onRulesChange }: Props) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();
  return (
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
              style={[styles.optionText, { color: selected ? colors.textOnAccent : colors.text }]}
            >
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export default function TableRules({ rules, onRulesChange }: Props) {
  const { t } = useTranslation(["blackjack", "feedback"]);
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState(false);
  const [activeTooltip, setActiveTooltip] = useState<Tooltip | null>(null);
  const setOpenState = (next: boolean) => {
    setOpen(next);
    setActiveTooltip(null);
  };

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
      <Modal
        visible={open}
        transparent
        animationType="slide"
        supportedOrientations={["portrait", "landscape"]}
        onRequestClose={() => setOpenState(false)}
      >
        <View style={[styles.backdrop, { backgroundColor: colors.overlay }]}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setOpenState(false)}
            accessible={false}
          />
          <View
            testID="blackjack-rules-sheet"
            style={[
              styles.sheet,
              {
                borderColor: colors.border,
                backgroundColor: colors.surfaceHigh,
                paddingBottom: Math.max(insets.bottom, 12),
              },
            ]}
          >
            <View style={styles.sheetHeader}>
              <Text style={[styles.sheetTitle, { color: colors.text }]}>{t("rules.title")}</Text>
              <Pressable
                onPress={() => setOpenState(false)}
                accessibilityRole="button"
                accessibilityLabel={t("feedback:close_label")}
                hitSlop={10}
              >
                <Text style={[styles.sheetClose, { color: colors.textMuted }]}>✕</Text>
              </Pressable>
            </View>
            <ScrollView testID="blackjack-rules-scroll" contentContainerStyle={styles.panel}>
              <RuleRow
                label={t("rules.dealerSoft17")}
                tooltipLabel={t("rules.soft17TooltipLabel")}
                tooltip={t("rules.soft17Tooltip")}
                expanded={activeTooltip === "soft17"}
                onToggleTooltip={() => toggleTooltip("soft17")}
              >
                <Soft17Options rules={rules} onRulesChange={onRulesChange} />
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

              {/* The rules every table plays by, not adjustable (#3741: standard rules). */}
              <View testID="blackjack-rules-standard" accessible style={ruleRowStyles.section}>
                <Text style={[ruleRowStyles.label, { color: colors.text }]}>
                  {t("rules.standardTitle")}
                </Text>
                <Text style={[ruleRowStyles.tooltip, { color: colors.textMuted }]}>
                  {t("rules.standard")}
                </Text>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Pressable
        style={styles.toggle}
        onPress={() => setOpenState(!open)}
        accessibilityRole="button"
        accessibilityLabel={t("rules.toggleLabel")}
        accessibilityState={{ expanded: open }}
        hitSlop={8}
      >
        <Text style={[styles.toggleText, { color: colors.textMuted }]} numberOfLines={1}>
          {open ? "▾" : "▸"} {t("rules.title")}
        </Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexShrink: 1,
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
  backdrop: {
    flex: 1,
    justifyContent: "flex-end",
  },
  sheet: {
    maxHeight: "80%",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    borderWidth: 1,
    paddingTop: 12,
  },
  sheetHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  sheetTitle: {
    fontSize: 15,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  sheetClose: {
    fontSize: 18,
    fontWeight: "700",
  },
  panel: {
    paddingHorizontal: 16,
    paddingBottom: 8,
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
