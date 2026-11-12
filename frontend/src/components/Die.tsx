/**
 * One die (#3748, motion #3749). Every time is in `game/yacht/motion.ts`.
 *
 *  - Tumble: while `rolling`, the whole die turns once (ease-out), hops up to 18 pt and flicks
 *    through random faces; at 80 % it shows its final face and lands with a small squash. Rolled
 *    dice start `TUMBLE_STAGGER_MS` apart (`rollOrder`); held dice stay still. All on the UI
 *    thread: one shared value drives the transform and the pips.
 *  - Hold: the ring fades in and the 4 pt lift eases in and out over `HOLD_MS`.
 *
 * Under Reduce Motion nothing animates: the face changes in place and a held die is lifted at
 * once. It is read live: turning it on mid-tumble snaps the die to rest, and turning it off again
 * never replays a tumble that has finished.
 */
import React, { useEffect, useRef } from "react";
import { Pressable, View, Text, StyleSheet } from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withDelay,
  withTiming,
  cancelAnimation,
  Easing,
  type SharedValue,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";
import {
  HOLD_MS,
  TUMBLE_FACE_MS,
  TUMBLE_HOP_PX,
  TUMBLE_HOP_SHARE,
  TUMBLE_LAND_AT,
  TUMBLE_MS,
  TUMBLE_SPIN_SHARE,
  TUMBLE_SQUASH_SCALE,
  TUMBLE_STAGGER_MS,
} from "../game/yacht/motion";

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
  /** Its place among the dice rolled (0 = the left-most rolled): its tumble starts that many staggers late. */
  rollOrder?: number;
  /** How fast the tumble plays (2 for the computer's fast last turn). */
  tumbleSpeed?: number;
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
const CELLS = [0, 1, 2, 3, 4, 5, 6, 7, 8] as const;

/** Tumble progress at rest (and the value a tumble ends on). */
const AT_REST = 1;

/**
 * The face a die shows at tumble progress `p` (0 to 1): a new random-looking face every
 * `TUMBLE_FACE_MS`, then its final face from `TUMBLE_LAND_AT` on. Deterministic per die, so a test
 * (or a frame strip) sees the same flicks every time.
 */
export function tumbleFace(p: number, finalFace: number, index: number): number {
  "worklet";
  if (p >= TUMBLE_LAND_AT) return finalFace;
  const k = Math.floor((p * TUMBLE_MS) / TUMBLE_FACE_MS);
  return 1 + ((index * 7 + k * 13 + index * k * 3) % 6);
}

/** The die's transform at tumble progress `p`, on top of its hold lift. */
export function tumbleTransform(p: number, lift: number) {
  "worklet";
  if (p >= AT_REST) {
    return [{ translateY: lift }, { rotate: "0deg" }, { scale: 1 }];
  }
  const spin = Math.min(1, p / TUMBLE_SPIN_SHARE);
  const eased = 1 - Math.pow(1 - spin, 3);
  const hop = -TUMBLE_HOP_PX * Math.sin(Math.PI * Math.min(1, p / TUMBLE_HOP_SHARE));
  const squash =
    p > TUMBLE_LAND_AT
      ? 1 +
        (TUMBLE_SQUASH_SCALE - 1) *
          Math.sin(((p - TUMBLE_LAND_AT) / (1 - TUMBLE_LAND_AT)) * Math.PI)
      : 1;
  return [{ translateY: lift + hop }, { rotate: `${360 * eased}deg` }, { scale: squash }];
}

/** One pip cell: its pip shows when the face at the current tumble progress has one there. */
function Pip({
  cell,
  progress,
  value,
  index,
  size,
  color,
}: {
  cell: number;
  progress: SharedValue<number>;
  value: number;
  index: number;
  size: number;
  color: string;
}) {
  const style = useAnimatedStyle(() => {
    const face = tumbleFace(progress.value, value, index);
    return { opacity: (PIP_PATTERNS[face] ?? []).includes(cell) ? 1 : 0 };
  }, [value, index, cell]);
  return (
    <View style={styles.cell}>
      <Animated.View
        style={[
          { width: size, height: size, borderRadius: size / 2, backgroundColor: color },
          style,
        ]}
      />
    </View>
  );
}

export default function Die({
  value,
  held,
  onPress,
  disabled,
  index,
  size,
  rolling = false,
  rollOrder = 0,
  tumbleSpeed = 1,
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

  const pipColor = held ? colors.accentText : colors.text;

  // Tumble progress: 0 at the start of a roll, AT_REST (1) once the die is at rest.
  const progress = useSharedValue(AT_REST);
  // The hold's lift (pt, negative is up) and the ring's fade-in.
  const lift = useSharedValue(held ? -DIE_LIFT : 0);
  const ringIn = useSharedValue(1);

  // The tumble starts when this die starts rolling. Keyed on `rolling` alone: Reduce Motion is
  // read live below, and turning it off again must not replay a tumble that has finished.
  useEffect(() => {
    if (!rolling) return;
    cancelAnimation(progress);
    if (reduceMotion) {
      progress.value = AT_REST;
      return;
    }
    const speed = tumbleSpeed > 0 ? tumbleSpeed : 1;
    progress.value = 0;
    progress.value = withDelay(
      (rollOrder * TUMBLE_STAGGER_MS) / speed,
      withTiming(AT_REST, { duration: TUMBLE_MS / speed, easing: Easing.linear })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rolling]);

  // Reduce Motion turned on mid-tumble (docs/ACCESSIBILITY.md section 3): the die snaps to rest,
  // showing its final face, and its hold is shown at once. Turning it off again changes nothing.
  useEffect(() => {
    if (!reduceMotion) return;
    cancelAnimation(progress);
    progress.value = AT_REST;
    cancelAnimation(lift);
    lift.value = held ? -DIE_LIFT : 0;
    cancelAnimation(ringIn);
    ringIn.value = 1;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reduceMotion]);

  // Hold: the die lifts a few points (it replaces the 1.12x scale, which grew into its neighbour)
  // and its ring fades in, over HOLD_MS. Not on mount: a restored held die is already up.
  const mounted = useRef(false);
  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }
    const to = held ? -DIE_LIFT : 0;
    if (reduceMotion) {
      lift.value = to;
      ringIn.value = 1;
      return;
    }
    lift.value = withTiming(to, { duration: HOLD_MS, easing: Easing.out(Easing.quad) });
    if (held) {
      ringIn.value = 0;
      ringIn.value = withTiming(1, { duration: HOLD_MS });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [held]);

  const dieStyle = useAnimatedStyle(() => ({
    transform: tumbleTransform(progress.value, lift.value),
  }));
  const ringStyle = useAnimatedStyle(() => ({ opacity: ringIn.value }));

  const ringColor = hinted ? colors.outcomeWin : held ? colors.accentText : null;

  return (
    <Animated.View style={[{ width: size, height: size }, dieStyle]}>
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
        <View style={styles.face}>
          {value > 0 ? (
            <View style={styles.grid}>
              {CELLS.map((cell) => (
                <Pip
                  key={cell}
                  cell={cell}
                  progress={progress}
                  value={value}
                  index={index}
                  size={pipSize}
                  color={pipColor}
                />
              ))}
            </View>
          ) : (
            <Text style={[styles.blank, { color: colors.textMuted }]}>—</Text>
          )}
        </View>
        {ringColor !== null && (
          <Animated.View
            testID={`yacht-die-${index}-${hinted ? "hint" : "held"}-ring`}
            pointerEvents="none"
            importantForAccessibility="no"
            style={[styles.ring, { borderColor: ringColor }, ringStyle]}
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
