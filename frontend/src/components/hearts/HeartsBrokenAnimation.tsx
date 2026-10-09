import React, { useEffect } from "react";
import { StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { Particle, useParticleGroup, type ParticleMotion } from "../shared/Particle";
import { useReduceMotion } from "../shared/useReduceMotion";
import { playTimedPhases } from "../shared/timedPhases";

interface Props {
  visible: boolean;
  onAnimationEnd: () => void;
}

// Six crack lines at 30° intervals radiating outward
const CRACKS: readonly ParticleMotion[] = [0, 30, 60, 90, 120, 150].map((angle) => ({
  kind: "ray" as const,
  angle,
  centerOrigin: true,
}));

export function HeartsBrokenAnimation({ visible, onAnimationEnd }: Props) {
  const { t } = useTranslation("hearts");
  const reduceMotion = useReduceMotion();
  const cracks = useParticleGroup();

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  // Tint opacity: 0 → 0.3 → 0.08 (hold) → 0 (fade out)
  const tintOpacity = useSharedValue(0);

  useEffect(() => {
    const crackValues = cracks.all();
    if (!visible || reduceMotion) {
      // Hidden — or reduced motion, which may have just been turned on
      // mid-sequence: clear every frame so nothing is left frozen.
      iconScale.value = 0;
      iconOpacity.value = 0;
      tintOpacity.value = 0;
      crackValues.forEach((c) => {
        c.value = 0;
      });
      if (!visible) return;
    }

    if (reduceMotion) {
      // Reduced motion: instant red tint flash only, ~0.3 s total
      tintOpacity.value = withSequence(
        withTiming(0.3, { duration: 50 }),
        withDelay(200, withTiming(0, { duration: 50 }))
      );
      return playTimedPhases({ phases: [], endAt: 300 }, onAnimationEnd);
    }

    // Phase 1 — burst (0–1000 ms)
    iconOpacity.value = 1;
    iconScale.value = withSequence(
      withTiming(1.3, { duration: 300 }),
      withSpring(1.0, { damping: 8, stiffness: 180 })
    );
    tintOpacity.value = withSequence(
      withTiming(0.3, { duration: 150 }),
      withDelay(350, withTiming(0.08, { duration: 500 }))
    );
    crackValues.forEach((c, i) => {
      c.value = withDelay(i * 60, withTiming(1, { duration: 300 }));
    });

    const cancelPhases = playTimedPhases(
      {
        phases: [
          // Phase 2 — linger: icon fades to reduced opacity after burst peak
          {
            at: 800,
            run: () => {
              iconOpacity.value = withTiming(0.25, { duration: 200 });
            },
          },
          // Phase 3 — fade everything out at ~2900 ms (total ~3.4 s)
          {
            at: 2900,
            run: () => {
              iconOpacity.value = withTiming(0, { duration: 500 });
              tintOpacity.value = withTiming(0, { duration: 500 });
              iconScale.value = withTiming(0, { duration: 500 });
              crackValues.forEach((c) => {
                c.value = withTiming(0, { duration: 400 });
              });
            },
          },
        ],
        endAt: 3400,
      },
      onAnimationEnd
    );

    return () => {
      cancelPhases();
      cancelAnimation(iconScale);
      cancelAnimation(iconOpacity);
      cancelAnimation(tintOpacity);
      crackValues.forEach((c) => cancelAnimation(c));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  // Tint layer uses its own opacity so it does not affect child elements
  const tintStyle = useAnimatedStyle(() => ({ opacity: tintOpacity.value }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));

  return (
    // Non-interactive wrapper — never blocks touches
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      {/* Red tint layer — separate from content so its opacity does not bleed into children */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.tintLayer, tintStyle]} />
      {/* Content: heart icon + radiating crack lines */}
      <View style={styles.content}>
        {CRACKS.map((motion, i) => (
          <Particle key={i} index={i} group={cracks} motion={motion} style={styles.crackLine} />
        ))}
        <Animated.Text
          style={[styles.heartIcon, iconStyle]}
          accessibilityLabel={t("events.heartsBroken")}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          ♥
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tintLayer: {
    backgroundColor: "#dc2626",
    zIndex: 100,
  },
  content: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 101,
  },
  heartIcon: {
    fontSize: 48,
    color: "#dc2626",
    lineHeight: 56,
  },
  crackLine: {
    position: "absolute",
    width: 80,
    height: 3,
    borderRadius: 2,
    backgroundColor: "#dc2626",
  },
});
