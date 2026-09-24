import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { AnimationOverlay } from "../shared/AnimationOverlay";
import { useTheme } from "../../theme/ThemeContext";

interface Props {
  visible: boolean;
  onDismiss: () => void;
}

// Card suit symbols scattered around the central badge
const CARD_SUITS = ["♠", "♥", "♦", "♣", "♠", "♥", "♦", "♣"] as const;
const SUIT_OFFSETS = [
  { x: -120, y: -100 },
  { x: 120, y: -100 },
  { x: -140, y: 0 },
  { x: 140, y: 0 },
  { x: -100, y: 100 },
  { x: 100, y: 100 },
  { x: -30, y: -130 },
  { x: 30, y: 130 },
] as const;

/**
 * The win celebration: a gold badge with card suits bursting around it.
 * Rendered in the shared result card's `celebration` slot (#2508); calls
 * `onDismiss` when it has played (at once under reduce motion) so the card
 * can appear. The card announces the result, so the badge stays silent.
 */
export function FreeCellGameWinAnimation({ visible, onDismiss }: Props) {
  const { t } = useTranslation("result");
  const { colors } = useTheme();
  // null until the setting has been read: the animation mounts at the moment of
  // the win, so it must not start before it knows whether motion is wanted.
  const [reduceMotion, setReduceMotion] = useState<boolean | null>(null);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const badgeScale = useSharedValue(0);
  const badgeOpacity = useSharedValue(0);

  // One shared value per card suit symbol
  const suit0 = useSharedValue(0);
  const suit1 = useSharedValue(0);
  const suit2 = useSharedValue(0);
  const suit3 = useSharedValue(0);
  const suit4 = useSharedValue(0);
  const suit5 = useSharedValue(0);
  const suit6 = useSharedValue(0);
  const suit7 = useSharedValue(0);
  const suits = [suit0, suit1, suit2, suit3, suit4, suit5, suit6, suit7];

  useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled()
      .catch(() => false)
      .then((enabled) => {
        if (alive) setReduceMotion(enabled);
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (!visible) {
      badgeScale.value = 0;
      badgeOpacity.value = 0;
      suits.forEach((s) => {
        s.value = 0;
      });
      cancelAnimation(badgeScale);
      cancelAnimation(badgeOpacity);
      suits.forEach((s) => cancelAnimation(s));
      return;
    }

    if (reduceMotion === null) return;
    if (reduceMotion) {
      // No motion wanted: go straight to the result card.
      onDismiss();
      return;
    }

    // Phase 1 — burst (0–600 ms)
    badgeScale.value = withSpring(1, { damping: 10, stiffness: 120 });
    badgeOpacity.value = withTiming(1, { duration: 300 });
    suits.forEach((s, i) => {
      s.value = withDelay(i * 50, withSpring(1, { damping: 8, stiffness: 100 }));
    });

    // Phase 2 — fade out after lingering
    const t1 = setTimeout(() => {
      badgeOpacity.value = withTiming(0, { duration: 500 });
      suits.forEach((s) => {
        s.value = withTiming(0, { duration: 400 });
      });
    }, 2200);
    const t2 = setTimeout(onDismiss, 2800);
    timersRef.current.push(t1, t2);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
    opacity: badgeOpacity.value,
  }));

  const suitStyles = suits.map((s) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: s.value }] }))
  );

  if (reduceMotion !== false) return null;

  return (
    <AnimationOverlay visible={visible} onDismiss={onDismiss}>
      <View style={styles.content} pointerEvents="none">
        {SUIT_OFFSETS.map((offset, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.suitSymbol,
              {
                left: "50%",
                top: "50%",
                marginLeft: offset.x,
                marginTop: offset.y,
                color: i % 2 === 0 ? colors.text : colors.error,
              },
              suitStyles[i],
            ]}
          >
            {CARD_SUITS[i]}
          </Animated.Text>
        ))}
        <Animated.View style={[styles.badge, { backgroundColor: colors.celebration }, badgeStyle]}>
          <Text
            style={[styles.badgeText, { color: colors.background }]}
            accessibilityElementsHidden
            importantForAccessibility="no"
          >
            {t("title.win")}
          </Text>
        </Animated.View>
      </View>
    </AnimationOverlay>
  );
}

const styles = StyleSheet.create({
  content: {
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 36,
    paddingVertical: 18,
  },
  badgeText: {
    fontSize: 38,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  suitSymbol: {
    position: "absolute",
    fontSize: 30,
  },
});
