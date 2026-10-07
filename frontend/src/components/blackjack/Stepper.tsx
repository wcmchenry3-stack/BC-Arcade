import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useTheme } from "../../theme/ThemeContext";

interface Props {
  /** Already-formatted value shown between the buttons, e.g. "6" or "75%". */
  value: string;
  onDecrement: () => void;
  onIncrement: () => void;
  decrementDisabled: boolean;
  incrementDisabled: boolean;
  decrementLabel: string;
  incrementLabel: string;
}

/** "− value +" control used by the blackjack table-rules rows. */
export default function Stepper({
  value,
  onDecrement,
  onIncrement,
  decrementDisabled,
  incrementDisabled,
  decrementLabel,
  incrementLabel,
}: Props) {
  const { colors } = useTheme();
  const btnStyle = [
    styles.stepBtn,
    { backgroundColor: colors.surface, borderColor: colors.border },
  ];
  return (
    <View style={styles.stepper}>
      <Pressable
        style={btnStyle}
        onPress={onDecrement}
        disabled={decrementDisabled}
        accessibilityRole="button"
        accessibilityLabel={decrementLabel}
      >
        <Text style={[styles.stepBtnText, { color: colors.text }]}>−</Text>
      </Pressable>
      <Text style={[styles.value, { color: colors.text }]}>{value}</Text>
      <Pressable
        style={btnStyle}
        onPress={onIncrement}
        disabled={incrementDisabled}
        accessibilityRole="button"
        accessibilityLabel={incrementLabel}
      >
        <Text style={[styles.stepBtnText, { color: colors.text }]}>+</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  stepper: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  stepBtn: {
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
  value: {
    fontSize: 15,
    fontWeight: "700",
    minWidth: 44,
    textAlign: "center",
  },
});
