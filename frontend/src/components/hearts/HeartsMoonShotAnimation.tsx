import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Particle, useParticleGroup, type ParticleMotion } from "../shared/Particle";
import { useReduceMotion } from "../shared/useReduceMotion";
import { playTimedPhases } from "../shared/timedPhases";
import {
  HEARTS_MOONSHOT_BACKDROP,
  HEARTS_MOONSHOT_LABEL,
  HEARTS_MOONSHOT_STAR,
} from "../../theme/theme.hearts";

interface Props {
  visible: boolean;
  shooterLabel: string;
  onAnimationEnd: () => void;
}

// Six stars scattered around the moon icon
const STARS: readonly ParticleMotion[] = [
  { kind: "pop", x: -90, y: -80 },
  { kind: "pop", x: 90, y: -80 },
  { kind: "pop", x: -120, y: 10 },
  { kind: "pop", x: 120, y: 10 },
  { kind: "pop", x: -70, y: 90 },
  { kind: "pop", x: 70, y: 90 },
];

export function HeartsMoonShotAnimation({ visible, shooterLabel, onAnimationEnd }: Props) {
  const { t } = useTranslation("hearts");
  const reduceMotion = useReduceMotion();
  const stars = useParticleGroup();

  const backdropOpacity = useSharedValue(0);
  const moonScale = useSharedValue(0);
  const moonOpacity = useSharedValue(0);
  const labelOpacity = useSharedValue(0);

  useEffect(() => {
    const starValues = stars.all();
    if (!visible) {
      backdropOpacity.value = 0;
      moonScale.value = 0;
      moonOpacity.value = 0;
      labelOpacity.value = 0;
      starValues.forEach((s) => {
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
      starValues.forEach((s) => {
        s.value = 1;
      });
      return playTimedPhases({ phases: [], endAt: 2200 }, onAnimationEnd);
    }

    // Phase 1 — burst in
    backdropOpacity.value = withTiming(0.65, { duration: 300 });
    moonOpacity.value = 1;
    moonScale.value = withSpring(1, { damping: 8, stiffness: 180 });
    starValues.forEach((s, i) => {
      s.value = withDelay(i * 120, withSpring(1, { damping: 10, stiffness: 200 }));
    });
    labelOpacity.value = withDelay(400, withTiming(1, { duration: 300 }));

    const cancelPhases = playTimedPhases(
      {
        phases: [
          // Phase 2 — fade everything out at 1700 ms (total 2200 ms)
          {
            at: 1700,
            run: () => {
              backdropOpacity.value = withTiming(0, { duration: 500 });
              moonScale.value = withTiming(0, { duration: 500 });
              moonOpacity.value = withTiming(0, { duration: 500 });
              labelOpacity.value = withTiming(0, { duration: 300 });
              starValues.forEach((s) => {
                s.value = withTiming(0, { duration: 400 });
              });
            },
          },
        ],
        endAt: 2200,
      },
      onAnimationEnd
    );

    return () => {
      cancelPhases();
      cancelAnimation(backdropOpacity);
      cancelAnimation(moonScale);
      cancelAnimation(moonOpacity);
      cancelAnimation(labelOpacity);
      starValues.forEach((s) => cancelAnimation(s));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const backdropStyle = useAnimatedStyle(() => ({ opacity: backdropOpacity.value }));
  const moonStyle = useAnimatedStyle(() => ({
    transform: [{ scale: moonScale.value }],
    opacity: moonOpacity.value,
  }));
  const labelStyle = useAnimatedStyle(() => ({ opacity: labelOpacity.value }));

  return (
    // Non-interactive wrapper — never blocks touches
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Dark backdrop — separate opacity so it doesn't affect child elements */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, backdropStyle]} />
      {/* Content: moon icon, staggered stars, shooter label */}
      <View style={styles.content}>
        {STARS.map((motion, i) => (
          <Particle key={i} index={i} group={stars} motion={motion} style={styles.star} glyph="★" />
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
    backgroundColor: HEARTS_MOONSHOT_BACKDROP,
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
    color: HEARTS_MOONSHOT_STAR,
  },
  label: {
    marginTop: 16,
    fontSize: 20,
    fontWeight: "700",
    color: HEARTS_MOONSHOT_LABEL,
    textAlign: "center",
    paddingHorizontal: 24,
  },
});
