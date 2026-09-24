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

const STAR_OFFSETS = [
  { x: -100, y: -90 },
  { x: 100, y: -90 },
  { x: -130, y: 0 },
  { x: 130, y: 0 },
  { x: -80, y: 90 },
  { x: 80, y: 90 },
] as const;

export function BlackjackCelebrationAnimation({ visible, onDismiss }: Props) {
  const { t } = useTranslation("blackjack");
  // The celebration gold token (#2501, #2507), so it reads in light mode too.
  const { colors } = useTheme();
  const [reduceMotion, setReduceMotion] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const labelScale = useSharedValue(0);
  const labelOpacity = useSharedValue(0);

  const star0 = useSharedValue(0);
  const star1 = useSharedValue(0);
  const star2 = useSharedValue(0);
  const star3 = useSharedValue(0);
  const star4 = useSharedValue(0);
  const star5 = useSharedValue(0);
  const stars = [star0, star1, star2, star3, star4, star5];

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (!visible) {
      labelScale.value = 0;
      labelOpacity.value = 0;
      stars.forEach((s) => {
        s.value = 0;
      });
      cancelAnimation(labelScale);
      cancelAnimation(labelOpacity);
      stars.forEach((s) => cancelAnimation(s));
      return;
    }

    if (reduceMotion) {
      labelScale.value = 1;
      labelOpacity.value = 1;
      stars.forEach((s) => {
        s.value = 1;
      });
      timersRef.current.push(setTimeout(onDismiss, 1500));
      return;
    }

    labelScale.value = withSpring(1, { damping: 10, stiffness: 120 });
    labelOpacity.value = withTiming(1, { duration: 300 });

    stars.forEach((s, i) => {
      s.value = withDelay(i * 60, withSpring(1, { damping: 8, stiffness: 100 }));
    });

    timersRef.current.push(
      setTimeout(() => {
        labelOpacity.value = withTiming(0, { duration: 400 });
        stars.forEach((s) => {
          s.value = withTiming(0, { duration: 300 });
        });
      }, 1600)
    );
    timersRef.current.push(setTimeout(onDismiss, 2100));

    return () => {
      timersRef.current.forEach(clearTimeout);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const labelStyle = useAnimatedStyle(() => ({
    transform: [{ scale: labelScale.value }],
    opacity: labelOpacity.value,
  }));

  const starStyles = stars.map((s) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ opacity: s.value, transform: [{ scale: s.value }] }))
  );

  return (
    <AnimationOverlay visible={visible} onDismiss={onDismiss}>
      <View style={styles.content} pointerEvents="none">
        {STAR_OFFSETS.map((offset, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.star,
              {
                left: "50%",
                top: "50%",
                marginLeft: offset.x,
                marginTop: offset.y,
                color: colors.celebration,
              },
              starStyles[i],
            ]}
          >
            ★
          </Animated.Text>
        ))}
        <Animated.View style={[styles.badge, { backgroundColor: colors.celebration }, labelStyle]}>
          <Text style={[styles.badgeText, { color: colors.background }]}>
            {t("outcome.blackjack")}
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
    paddingHorizontal: 32,
    paddingVertical: 16,
  },
  badgeText: {
    fontSize: 36,
    fontWeight: "900",
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  star: {
    position: "absolute",
    fontSize: 28,
  },
});
