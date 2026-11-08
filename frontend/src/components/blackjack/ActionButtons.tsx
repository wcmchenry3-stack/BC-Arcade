import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import MaterialCommunityIcons from "@expo/vector-icons/MaterialCommunityIcons";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import type { BlackjackLayout } from "../../game/blackjack/layout";

interface Props {
  onHit: () => void;
  onStand: () => void;
  onDoubleDown: () => void;
  onSplit: () => void;
  doubleDownAvailable: boolean;
  splitAvailable: boolean;
  loading: boolean;
  layout: BlackjackLayout;
  /**
   * "cluster" (default): round buttons in a pill. "dock" (#3580): four equal
   * buttons across the table's dock.
   */
  variant?: "cluster" | "dock";
}

export default function ActionButtons({
  onHit,
  onStand,
  onDoubleDown,
  onSplit,
  doubleDownAvailable,
  splitAvailable,
  loading,
  layout,
  variant = "cluster",
}: Props) {
  const { t } = useTranslation("blackjack");
  const { colors } = useTheme();

  const ddLabel = doubleDownAvailable
    ? t("actions.doubleDownLabel")
    : t("actions.doubleDownDisabledLabel");

  const splitLabel = splitAvailable ? t("actions.splitLabel") : t("actions.splitDisabledLabel");

  const dock = variant === "dock";
  const btnStyle = dock
    ? styles.dockBtn
    : {
        width: layout.buttonSize,
        height: layout.buttonSize,
        borderRadius: layout.buttonRadius,
      };
  const iconSize = dock ? 20 : layout.buttonIconSize;

  return (
    <View
      style={
        dock
          ? styles.dock
          : [
              styles.cluster,
              {
                gap: layout.clusterGap,
                paddingHorizontal: layout.clusterPaddingH,
                paddingVertical: layout.clusterPaddingV,
                backgroundColor: colors.surfaceHigh,
                borderColor: colors.border,
              },
            ]
      }
    >
      {/* Hit — primary cyan gradient CTA */}
      <Pressable
        style={[
          styles.btn,
          btnStyle,
          {
            backgroundColor: colors.accent,
            shadowColor: colors.accent,
            shadowOffset: { width: 0, height: 0 },
            shadowOpacity: 0.4,
            shadowRadius: 12,
            elevation: 6,
          },
        ]}
        onPress={onHit}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={t("actions.hitLabel")}
        accessibilityState={{ disabled: loading, busy: loading }}
      >
        <MaterialIcons name="add" size={iconSize} color={colors.textOnAccent} />
        <Text style={[styles.btnLabel, { color: colors.textOnAccent }]}>{t("actions.hit")}</Text>
      </Pressable>

      {/* Stand — secondary purple outline */}
      <Pressable
        style={[styles.btn, btnStyle, { borderColor: colors.secondary, borderWidth: 2 }]}
        onPress={onStand}
        disabled={loading}
        accessibilityRole="button"
        accessibilityLabel={t("actions.standLabel")}
        accessibilityState={{ disabled: loading, busy: loading }}
      >
        {/* hand-back-right is the closest MCI equivalent to Material Symbols front_hand */}
        <MaterialCommunityIcons name="hand-back-right" size={iconSize} color={colors.secondary} />
        <Text style={[styles.btnLabel, { color: colors.secondary }]}>{t("actions.stand")}</Text>
      </Pressable>

      {/* Double Down — tertiary outline, disabled when unavailable */}
      <Pressable
        style={[
          styles.btn,
          btnStyle,
          {
            borderColor: colors.border,
            borderWidth: 2,
            opacity: doubleDownAvailable ? 1 : 0.4,
          },
        ]}
        onPress={onDoubleDown}
        disabled={!doubleDownAvailable || loading}
        accessibilityRole="button"
        accessibilityLabel={ddLabel}
        accessibilityState={{ disabled: !doubleDownAvailable || loading }}
      >
        {/* numeric-2-circle-outline is the closest MCI equivalent to Material Symbols stat_2 */}
        <MaterialCommunityIcons
          name="numeric-2-circle-outline"
          size={iconSize}
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
          btnStyle,
          {
            borderColor: colors.border,
            borderWidth: 2,
            opacity: splitAvailable ? 1 : 0.4,
          },
        ]}
        onPress={onSplit}
        disabled={!splitAvailable || loading}
        accessibilityRole="button"
        accessibilityLabel={splitLabel}
        accessibilityState={{ disabled: !splitAvailable || loading }}
      >
        <MaterialIcons name="call-split" size={iconSize} color={colors.textMuted} />
        <Text style={[styles.btnLabel, { color: colors.textMuted }]}>{t("actions.split")}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: {
    flexDirection: "row",
    gap: 8,
    width: "100%",
  },
  dockBtn: {
    flex: 1,
    height: 50,
    borderRadius: 14,
  },
  cluster: {
    flexDirection: "row",
    borderRadius: 50,
    borderWidth: 1,
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
