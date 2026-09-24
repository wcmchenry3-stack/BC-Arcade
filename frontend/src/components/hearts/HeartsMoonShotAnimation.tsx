import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";

interface Props {
  visible: boolean;
  shooterLabel: string;
  onAnimationEnd: () => void;
}

// Six stars scattered around the moon icon
const STAR_OFFSETS = [
  { x: -90, y: -80 },
  { x: 90, y: -80 },
  { x: -120, y: 10 },
  { x: 120, y: 10 },
  { x: -70, y: 90 },
  { x: 70, y: 90 },
] as const;

export function HeartsMoonShotAnimation({ visible, shooterLabel, onAnimationEnd }: Props) {
  const { t } = useTranslation("hearts");
  const [reduceMotion, setReduceMotion] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const backdropOpacity = useSharedValue(0);
  const moonScale = useSharedValue(0);
  const moonOpacity = useSharedValue(0);
  const labelOpacity = useSharedValue(0);

  // One shared value per star — hooks cannot be called in a loop
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
    if (!visible) {
      backdropOpacity.value = 0;
      moonScale.value = 0;
      moonOpacity.value = 0;
      labelOpacity.value = 0;
      stars.forEach((s) => {
        s.value = 0;
      });
      return;
    }

    if (reduceMotion) {
      // Reduced motion: static display, 2.2 s dismiss
      backdropOpacity.value = 0.65;
      moonScale.value = 1;
      moonOpacity.value = 1;
      labelOpacity.value = 1;
      stars.forEach((s) => {
        s.value = 1;
      });
      const t1 = setTimeout(onAnimationEnd, 2200);
      timersRef.current.push(t1);
      return () => {
        clearTimeout(t1);
        timersRef.current = [];
      };
    }

    // Phase 1 — burst in
    backdropOpacity.value = withTiming(0.65, { duration: 300 });
    moonOpacity.value = 1;
    moonScale.value = withSpring(1, { damping: 8, stiffness: 180 });
    stars.forEach((s, i) => {
      s.value = withDelay(i * 120, withSpring(1, { damping: 10, stiffness: 200 }));
    });
    labelOpacity.value = withDelay(400, withTiming(1, { duration: 300 }));

    // Phase 2 — fade everything out at 1700 ms (total 2200 ms)
    const t1 = setTimeout(() => {
      backdropOpacity.value = withTiming(0, { duration: 500 });
      moonScale.value = withTiming(0, { duration: 500 });
      moonOpacity.value = withTiming(0, { duration: 500 });
      labelOpacity.value = withTiming(0, { duration: 300 });
      stars.forEach((s) => {
        s.value = withTiming(0, { duration: 400 });
      });
    }, 1700);

    const t2 = setTimeout(onAnimationEnd, 2200);
    timersRef.current.push(t1, t2);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      cancelAnimation(backdropOpacity);
      cancelAnimation(moonScale);
      cancelAnimation(moonOpacity);
      cancelAnimation(labelOpacity);
      stars.forEach((s) => cancelAnimation(s));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const moonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: moonScale.value }],
    opacity: moonOpacity.value,
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));
  const star0Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: STAR_OFFSETS[0].x },
      { translateY: STAR_OFFSETS[0].y },
      { scale: star0.value },
    ],
    opacity: star0.value,
  }));
  const star1Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: STAR_OFFSETS[1].x },
      { translateY: STAR_OFFSETS[1].y },
      { scale: star1.value },
    ],
    opacity: star1.value,
  }));
  const star2Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: STAR_OFFSETS[2].x },
      { translateY: STAR_OFFSETS[2].y },
      { scale: star2.value },
    ],
    opacity: star2.value,
  }));
  const star3Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: STAR_OFFSETS[3].x },
      { translateY: STAR_OFFSETS[3].y },
      { scale: star3.value },
    ],
    opacity: star3.value,
  }));
  const star4Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: STAR_OFFSETS[4].x },
      { translateY: STAR_OFFSETS[4].y },
      { scale: star4.value },
    ],
    opacity: star4.value,
  }));
  const star5Style = useAnimatedStyle(() => ({
    transform: [
      { translateX: STAR_OFFSETS[5].x },
      { translateY: STAR_OFFSETS[5].y },
      { scale: star5.value },
    ],
    opacity: star5.value,
  }));
  const starStyles = [star0Style, star1Style, star2Style, star3Style, star4Style, star5Style];

  return (
    // Non-interactive wrapper — never blocks touches
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Dark backdrop — separate opacity so it doesn't affect child elements */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      {/* Content: moon icon, staggered stars, shooter label */}
      <View style={styles.content}>
        {starStyles.map((style, i) => (
          <Animated.Text key={i} style={[styles.star, style]}>
            ★
          </Animated.Text>
        ))}
        <Animated.Text
          style={[styles.moonIcon, moonStyle]}
          accessibilityLabel={t("events.moonShot", { name: shooterLabel })}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          🌙
        </Animated.Text>
        <Animated.Text style={[styles.label, labelStyle]}>
          {t("events.moonShot", { name: shooterLabel })}
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    backgroundColor: "#000000",
    zIndex: 100,
  },
  content: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 101,
  },
  moonIcon: {
    fontSize: 64,
    lineHeight: 72,
  },
  star: {
    position: "absolute",
    fontSize: 24,
    color: "#fbbf24",
  },
  label: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
    paddingHorizontal: 24,
  },
});
