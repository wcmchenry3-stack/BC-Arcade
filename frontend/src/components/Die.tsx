import React, { useEffect } from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
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

/** How far (pt) a held die lifts. The dice row reserves this much above the dice. */
export const DIE_LIFT = 4;
/** Thickness (pt) of the held / hint ring, drawn just outside the die. */
const RING = 3;

interface DieProps {
  value: number;
  held: boolean;
  onPress: () => void;
  disabled: boolean;
  index: number;
  /** Side length (pt), from the width the dice row has (DiceRow). */
  size: number;
  /** True while this die is part of an active roll animation. */
  rolling?: boolean;
  /** When true, skip all animations (accessibility reduce-motion). */
  reduceMotion?: boolean;
  /** The Hint suggests keeping this die: a green ring. */
  hinted?: boolean;
  /** Draw the die faded (a finished game). Dice are not dimmed before the first roll or on the computer's turn. */
  dimmed?: boolean;
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
  size,
  rolling = false,
  reduceMotion = false,
  hinted = false,
  dimmed = false,
}: DieProps) {
  const { t } = useTranslation("yacht");
  const { colors } = useTheme();
  const pipSize = Math.max(5, Math.round(size * 0.14));

  const displayValue = value > 0 ? value : t("dice.labelBlank");
  // Held is said, not shown by colour alone: the label carries it (the ring and lift are visual).
  // The Hint's suggestion is said too, while it is up (the green ring is only visual).
  const heldSuffix = `${held ? t("dice.heldSuffix") : ""}${hinted ? t("dice.hintedSuffix") : ""}`;
  const label = t("dice.label", { index: index + 1, value: displayValue, heldSuffix });

  const pips = PIP_PATTERNS[value] ?? [];
  const pipColor = held ? colors.accentText : colors.text;

  // Rotation for roll tumble animation
  const rotation = useSharedValue(0);
  // Lift for hold/release spring
  const lift = useSharedValue(0);

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

  // Hold spring: a held die lifts a few points (it replaces the 1.12x scale, which grew into its neighbour)
  useEffect(() => {
    if (reduceMotion) {
      lift.value = held ? -DIE_LIFT : 0;
      return;
    }
    lift.value = withSpring(held ? -DIE_LIFT : 0, { damping: 8, stiffness: 200 });
  }, [held, reduceMotion, lift]);

  const rollStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${rotation.value}deg` }],
  }));

  const liftStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: lift.value }],
  }));

  const ringColor = hinted ? colors.outcomeWin : held ? colors.accentText : null;

  return (
    <Animated.View style={[{ width: size, height: size }, liftStyle]}>
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
            width: size,
            height: size,
            padding: Math.round(size * 0.1),
            backgroundColor: held ? colors.heldBg : colors.dieBg,
            borderColor: held ? colors.accentText : colors.dieBorder,
            transform: [{ scale: pressed && !disabled ? 0.95 : 1 }],
          },
          dimmed && styles.dimmed,
        ]}
      >
        <Animated.View style={[styles.face, rollStyle]}>
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
        {ringColor !== null && (
          <View
            testID={`yacht-die-${index}-${hinted ? "hint" : "held"}-ring`}
            pointerEvents="none"
            importantForAccessibility="no"
            style={[styles.ring, { borderColor: ringColor }]}
          />
        )}
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  die: {
    borderRadius: 10,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  dimmed: {
    opacity: 0.4,
  },
  face: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
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
  // The held / hint ring: just outside the die, inside the gap between dice (never past the row).
  ring: {
    position: "absolute",
    top: -RING,
    left: -RING,
    right: -RING,
    bottom: -RING,
    borderWidth: RING,
    borderRadius: 10 + RING,
  },
});
