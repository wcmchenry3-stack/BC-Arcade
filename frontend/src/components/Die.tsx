import React, { useEffect } from "react";
import {
  Pressable,
  View,
  Text,
  StyleSheet,
  Platform,
  useWindowDimensions,
  ViewStyle,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSpring,
  withSequence,
  withTiming,
  cancelAnimation,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";

interface DieProps {
  value: number;
  held: boolean;
  onPress: () => void;
  disabled: boolean;
  index: number;
  /** True while this die is part of an active roll animation. */
  rolling?: boolean;
  /** When true, skip all animations (accessibility reduce-motion). */
  reduceMotion?: boolean;
}

// Pip positions in a 3x3 grid, indexed 0..8 (row-major)
// 0 1 2
// 3 4 5
// 6 7 8
const PIP_PATTERNS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export default function Die({
  value,
  held,
  onPress,
  disabled,
  index,
  rolling = false,
  reduceMotion = false,
}: DieProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const { width } = useWindowDimensions();
  const dieSize = Math.min(60, (width - 80) / 5);
  const pipSize = Math.max(6, Math.round(dieSize * 0.14));

  const displayValue = value > 0 ? value : t("dice.labelBlank");
  const heldSuffix = held ? t("dice.heldSuffix") : "";
  const label = t("dice.label", { index: index + 1, value: displayValue, heldSuffix });

  const pips = PIP_PATTERNS[value] ?? [];
  const pipColor = held ? colors.accent : colors.text;

  // Rotation for roll tumble animation
  const rotation = useSharedValue(0);
  // Scale for hold/release spring
  const holdScale = useSharedValue(1);

  // Roll tumble: spin die when rolling prop turns true
  useEffect(() => {
    if (!rolling) return;
    if (reduceMotion) return;
    cancelAnimation(rotation);
    rotation.value = withSequence(
      withTiming(360 * 2, { duration: 500 }),
      withTiming(0, { duration: 0 })
    );
  }, [rolling, reduceMotion, rotation]);

  // Hold spring: pop scale when held state changes
  useEffect(() => {
    if (reduceMotion) {
      holdScale.value = 1;
      return;
    }
    holdScale.value = withSpring(held ? 1.12 : 1, { damping: 8, stiffness: 200 });
  }, [held, reduceMotion, holdScale]);

  const rollStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const holdStyle = useAnimatedStyle(() => ({
    transform: [{ scale: holdScale.value }],
  }));

  // Web-only neon glow when held
  const glowStyle: ViewStyle | null =
    held && Platform.OS === "web"
      ? ({
          boxShadow: `0 0 14px ${colors.accent}66, 0 0 4px ${colors.accent}`,
        } as ViewStyle)
      : null;

  return (
    <Animated.View style={holdStyle}>
      <Pressable
        onPress={onPress}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityState={{ checked: held, disabled }}
        accessibilityLabel={label}
        accessibilityHint={disabled ? undefined : held ? t("dice.unholdHint") : t("dice.holdHint")}
        testID={`yacht-die-${index}`}
        style={({ pressed }) => [
          styles.die,
          {
            width: dieSize,
            height: dieSize,
            backgroundColor: held ? colors.heldBg : colors.dieBg,
            borderColor: held ? colors.heldBorder : colors.dieBorder,
            borderWidth: held ? 2 : 1,
            transform: [{ scale: pressed && !disabled ? 0.95 : 1 }],
          },
          glowStyle,
          disabled && styles.disabled,
        ]}
      >
        <Animated.View
          style={[
            { flex: 1, width: "100%", alignItems: "center", justifyContent: "center" },
            rollStyle,
          ]}
        >
          {value > 0 ? (
            <View style={styles.grid}>
              {Array.from({ length: 9 }).map((_, i) => (
                <View key={i} style={styles.cell}>
                  {pips.includes(i) && (
                    <View
                      style={{
                        width: pipSize,
                        height: pipSize,
                        borderRadius: pipSize / 2,
                        backgroundColor: pipColor,
                      }}
                    />
                  )}
                </View>
              ))}
            </View>
          ) : (
            <Text style={[styles.blank, { color: colors.textMuted }]}>—</Text>
          )}
        </Animated.View>
        {held && (
          <View
            style={[styles.heldBadge, { backgroundColor: colors.accent }]}
            importantForAccessibility="no"
          >
            <Text style={[styles.heldBadgeText, { color: colors.textOnAccent }]}>HELD</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  die: {
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    margin: 6,
    padding: 6,
  },
  disabled: {
    opacity: 0.4,
  },
  grid: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    width: "100%",
    height: "100%",
  },
  cell: {
    width: "33.333%",
    height: "33.333%",
    alignItems: "center",
    justifyContent: "center",
  },
  blank: {
    fontSize: 22,
    fontWeight: "700",
  },
  heldBadge: {
    position: "absolute",
    top: -6,
    right: -6,
    paddingHorizontal: 5,
    paddingVertical: 1,
    borderRadius: 4,
  },
  heldBadgeText: {
    fontSize: 8,
    fontWeight: "900",
    letterSpacing: 0.5,
  },
});
