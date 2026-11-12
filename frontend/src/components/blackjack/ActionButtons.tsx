import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import { DOCK_BUTTON_HEIGHT } from "../../game/blackjack/layout";

/** Hit, Stand, Double Down and Split: four equal buttons across the table's dock (#3580). */
interface Props {
  onHit: () => void;
  onStand: () => void;
  onDoubleDown: () => void;
  onSplit: () => void;
  doubleDownAvailable: boolean;
  splitAvailable: boolean;
  /**
   * Every button greyed and off: the dealer's turn is still playing out on the felt (owner
   * decision, #3720), so the result's dock only replaces this one when the result shows.
   */
  disabled?: boolean;
}

const ICON_SIZE = 20;

export default function ActionButtons({
  onHit,
  onStand,
  onDoubleDown,
  onSplit,
  doubleDownAvailable: canDouble,
  splitAvailable: canSplit,
  disabled = false,
}: Props) {
  const doubleDownAvailable = canDouble && !disabled;
  const splitAvailable = canSplit && !disabled;
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();

  const ddLabel = doubleDownAvailable
    ? t("actions.doubleDownLabel")
    : t("actions.doubleDownDisabledLabel");

  const splitLabel = splitAvailable ? t("actions.splitLabel") : t("actions.splitDisabledLabel");

  return (
    <View style={styles.dock}>
      {/* Hit — primary cyan gradient CTA */}
      <Pressable
        style={[
          styles.btn,
          styles.dockBtn,
          {
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
            elevation: 6,
          },
          disabled && styles.off,
        ]}
        onPress={onHit}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("actions.hitLabel")}
        accessibilityState={{ disabled }}
      >
        <MaterialIcons name="add" size={ICON_SIZE} color={colors.textOnAccent} />
        <Text style={[styles.btnLabel, { color: colors.textOnAccent }]}>{t("actions.hit")}</Text>
      </Pressable>

      {/* Stand — secondary purple outline */}
      <Pressable
        style={[
          styles.btn,
          styles.dockBtn,
          { borderColor: colors.secondary, borderWidth: 2 },
          disabled && styles.off,
        ]}
        onPress={onStand}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={t("actions.standLabel")}
        accessibilityState={{ disabled }}
      >
        {/* hand-back-right is the closest MCI equivalent to Material Symbols front_hand */}
        <MaterialCommunityIcons name="hand-back-right" size={ICON_SIZE} color={colors.secondary} />
        <Text style={[styles.btnLabel, { color: colors.secondary }]}>{t("actions.stand")}</Text>
      </Pressable>

      {/* Double Down — tertiary outline, disabled when unavailable */}
      <Pressable
        style={[
          styles.btn,
          styles.dockBtn,
          {
            borderColor: colors.border,
            borderWidth: 2,
            opacity: doubleDownAvailable ? 1 : 0.4,
          },
        ]}
        onPress={onDoubleDown}
        disabled={!doubleDownAvailable}
        accessibilityRole="button"
        accessibilityLabel={ddLabel}
        accessibilityState={{ disabled: !doubleDownAvailable }}
      >
        {/* numeric-2-circle-outline is the closest MCI equivalent to Material Symbols stat_2 */}
        <MaterialCommunityIcons
          name="numeric-2-circle-outline"
          size={ICON_SIZE}
          color={colors.textMuted}
        />
        <Text style={[styles.btnLabel, styles.btnLabelSmall, { color: colors.textMuted }]}>
          {t("actions.doubleDown")}
        </Text>
      </Pressable>

      {/* Split — tertiary outline, disabled when unavailable */}
      <Pressable
        style={[
          styles.btn,
          styles.dockBtn,
          {
            borderColor: colors.border,
            borderWidth: 2,
            opacity: splitAvailable ? 1 : 0.4,
          },
        ]}
        onPress={onSplit}
        disabled={!splitAvailable}
        accessibilityRole="button"
        accessibilityLabel={splitLabel}
        accessibilityState={{ disabled: !splitAvailable }}
      >
        <MaterialIcons name="call-split" size={ICON_SIZE} color={colors.textMuted} />
        <Text style={[styles.btnLabel, { color: colors.textMuted }]}>{t("actions.split")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  off: {
    opacity: 0.4,
  },
  dock: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  dockBtn: {
    flex: 1,
    height: DOCK_BUTTON_HEIGHT,
    borderRadius: 14,
  },
  btn: {
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  btnLabel: {
    fontSize: 9,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  btnLabelSmall: {
    fontSize: 8,
    textAlign: "center",
    lineHeight: 10,
  },
});
