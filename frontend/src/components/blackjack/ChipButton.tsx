import React from "react";
import { Text, Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from "react-native";
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

/**
 * A chip's face: the round, filled disc the tray's chips are drawn with. Shared by the tray
 * (ChipButton), the stake beside a hand's total and the chips moving on the felt (#3720), so they
 * all look alike. Chip styles (#3429's "Gold Chip Set" unlock) are not drawn anywhere yet; this is
 * the default face.
 */
export function chipShape(size: number, color: string): ViewStyle {
  return { width: size, height: size, borderRadius: size / 2, backgroundColor: color };
}

/** A chip's face, decorative: hidden from screen readers (the amount beside it is read). */
export function ChipFace({
  size,
  color,
  testID,
  style,
}: {
  readonly size: number;
  readonly color: string;
  readonly testID?: string;
  readonly style?: StyleProp<ViewStyle>;
}) {
  return (
    <View
      testID={testID}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={[chipShape(size, color), style]}
    />
  );
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
      style={[styles.chip, chipShape(size, chipColor), { opacity: disabled ? 0.35 : 1 }]}
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
