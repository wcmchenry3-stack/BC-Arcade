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
import { Particle, useParticleGroup, type ParticleMotion } from "../shared/Particle";
import { useReduceMotion } from "../shared/useReduceMotion";
import { playTimedPhases } from "../shared/timedPhases";
import { CELEBRATION_SPARKLE } from "../../theme/theme.constants";

// Six sparkle rays at 60° intervals
const RAYS: readonly ParticleMotion[] = [0, 60, 120, 180, 240, 300].map((angle) => ({
  kind: "ray" as const,
  angle,
}));

interface Props {
  visible: boolean;
  onAnimationEnd: () => void;
}

export function FreeCellFoundationAnimation({ visible, onAnimationEnd }: Props) {
  const reduceMotion = useReduceMotion();
  const rays = useParticleGroup();

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  const tintOpacity = useSharedValue(0);

  useEffect(() => {
    const rayValues = rays.all();
    if (!visible || reduceMotion) {
      // Hidden — or reduced motion, which may have just been turned on
      // mid-sequence: clear every frame so nothing is left frozen.
      iconScale.value = 0;
      iconOpacity.value = 0;
      tintOpacity.value = 0;
      rayValues.forEach((r) => {
        r.value = 0;
      });
      if (!visible) return;
    }

    if (reduceMotion) {
      tintOpacity.value = withSequence(
        withTiming(0.25, { duration: 50 }),
        withDelay(150, withTiming(0, { duration: 50 }))
      );
      return playTimedPhases({ phases: [], endAt: 250 }, onAnimationEnd);
    }

    // Burst phase
    iconOpacity.value = 1;
    iconScale.value = withSequence(
      withTiming(1.4, { duration: 250 }),
      withSpring(1.0, { damping: 8, stiffness: 200 })
    );
    tintOpacity.value = withSequence(
      withTiming(0.2, { duration: 100 }),
      withDelay(200, withTiming(0.05, { duration: 400 }))
    );
    rayValues.forEach((r, i) => {
      r.value = withDelay(i * 40, withTiming(1, { duration: 250 }));
    });

    const cancelPhases = playTimedPhases(
      {
        phases: [
          // Fade out at ~1400 ms (total ~1.8 s)
          {
            at: 1400,
            run: () => {
              iconOpacity.value = withTiming(0, { duration: 400 });
              tintOpacity.value = withTiming(0, { duration: 400 });
              iconScale.value = withTiming(0.8, { duration: 400 });
              rayValues.forEach((r) => {
                r.value = withTiming(0, { duration: 300 });
              });
            },
          },
        ],
        endAt: 1800,
      },
      onAnimationEnd
    );

    return () => {
      cancelPhases();
      cancelAnimation(iconScale);
      cancelAnimation(iconOpacity);
      cancelAnimation(tintOpacity);
      rayValues.forEach((r) => cancelAnimation(r));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const tintStyle = useAnimatedStyle(() => ({ opacity: tintOpacity.value }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.tintLayer,
          { backgroundColor: CELEBRATION_SPARKLE },
          tintStyle,
        ]}
      />
      <View style={styles.content}>
        {RAYS.map((motion, i) => (
          <Particle
            key={i}
            index={i}
            group={rays}
            motion={motion}
            style={[styles.sparkleRay, { backgroundColor: CELEBRATION_SPARKLE }]}
          />
        ))}
        <Animated.Text
          style={[styles.sparkleIcon, iconStyle]}
          accessibilityLabel="Foundation complete"
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          ✨
        </Animated.Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  tintLayer: {
    zIndex: 100,
  },
  content: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 101,
  },
  sparkleIcon: {
    fontSize: 52,
    lineHeight: 60,
  },
  sparkleRay: {
    position: "absolute",
    width: 70,
    height: 3,
    borderRadius: 2,
  },
});
