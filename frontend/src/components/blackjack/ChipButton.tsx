import React from "react";
import { Text, Pressable, StyleSheet } from "react-native";
import { useTranslation } from "react-i18next";
import { typography } from "../../theme/typography";

interface ChipButtonProps {
  amount: number;
  onPress: () => void;
  disabled?: boolean;
  chipColor: string;
  textColor: string;
  sublabel?: string;
  /** Diameter in px (default 64). The table dock uses smaller chips. */
  size?: number;
}

export default function ChipButton({
  amount,
  onPress,
  disabled,
  chipColor,
  textColor,
  sublabel,
  size = 64,
}: ChipButtonProps) {
  const { t } = useTranslation("blackjack");

  return (
    <Pressable
      testID={`blackjack-chip-${amount}`}
      style={[
        styles.chip,
        { width: size, height: size, borderRadius: size / 2 },
        { backgroundColor: chipColor, opacity: disabled ? 0.35 : 1 },
      ]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={
        disabled ? t("chip.disabledLabel", { amount }) : t("chip.addLabel", { amount })
      }
      accessibilityState={{ disabled }}
    >
      <Text style={[styles.amount, { color: textColor, fontFamily: typography.heading }]}>
        {amount}
      </Text>
      {sublabel ? (
        <Text style={[styles.sublabel, { color: textColor, fontFamily: typography.label }]}>
          {sublabel}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: "center",
    justifyContent: "center",
    gap: 2,
  },
  amount: {
    fontSize: 17,
    lineHeight: 21,
  },
  sublabel: {
    fontSize: 9,
    textTransform: "uppercase",
    letterSpacing: 0.6,
    lineHeight: 11,
  },
});
