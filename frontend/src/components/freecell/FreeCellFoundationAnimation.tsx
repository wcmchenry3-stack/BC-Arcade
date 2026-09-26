import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";

// Six sparkle rays at 60° intervals
const SPARKLE_ANGLES = [0, 60, 120, 180, 240, 300] as const;

interface Props {
  visible: boolean;
  onAnimationEnd: () => void;
}

export function FreeCellFoundationAnimation({ visible, onAnimationEnd }: Props) {
  const [reduceMotion, setReduceMotion] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  const tintOpacity = useSharedValue(0);

  // One shared value per sparkle ray — hooks cannot be called in a loop
  const ray0 = useSharedValue(0);
  const ray1 = useSharedValue(0);
  const ray2 = useSharedValue(0);
  const ray3 = useSharedValue(0);
  const ray4 = useSharedValue(0);
  const ray5 = useSharedValue(0);
  const rays = [ray0, ray1, ray2, ray3, ray4, ray5];

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!visible) {
      iconScale.value = 0;
      iconOpacity.value = 0;
      tintOpacity.value = 0;
      rays.forEach((r) => {
        r.value = 0;
      });
      return;
    }

    if (reduceMotion) {
      tintOpacity.value = withSequence(
        withTiming(0.25, { duration: 50 }),
        withDelay(150, withTiming(0, { duration: 50 }))
      );
      const t1 = setTimeout(onAnimationEnd, 250);
      timersRef.current.push(t1);
      return () => {
        clearTimeout(t1);
        timersRef.current = [];
      };
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
    rays.forEach((r, i) => {
      r.value = withDelay(i * 40, withTiming(1, { duration: 250 }));
    });

    // Fade out at ~1400 ms (total ~1.8 s)
    const t1 = setTimeout(() => {
      iconOpacity.value = withTiming(0, { duration: 400 });
      tintOpacity.value = withTiming(0, { duration: 400 });
      iconScale.value = withTiming(0.8, { duration: 400 });
      rays.forEach((r) => {
        r.value = withTiming(0, { duration: 300 });
      });
    }, 1400);

    const t2 = setTimeout(onAnimationEnd, 1800);
    timersRef.current.push(t1, t2);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      cancelAnimation(iconScale);
      cancelAnimation(iconOpacity);
      cancelAnimation(tintOpacity);
      rays.forEach((r) => cancelAnimation(r));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const tintStyle = useAnimatedStyle(() => ({ opacity: tintOpacity.value }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));
  const ray0Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${SPARKLE_ANGLES[0]}deg` }, { scaleX: ray0.value }],
    opacity: ray0.value,
  }));
  const ray1Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${SPARKLE_ANGLES[1]}deg` }, { scaleX: ray1.value }],
    opacity: ray1.value,
  }));
  const ray2Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${SPARKLE_ANGLES[2]}deg` }, { scaleX: ray2.value }],
    opacity: ray2.value,
  }));
  const ray3Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${SPARKLE_ANGLES[3]}deg` }, { scaleX: ray3.value }],
    opacity: ray3.value,
  }));
  const ray4Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${SPARKLE_ANGLES[4]}deg` }, { scaleX: ray4.value }],
    opacity: ray4.value,
  }));
  const ray5Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${SPARKLE_ANGLES[5]}deg` }, { scaleX: ray5.value }],
    opacity: ray5.value,
  }));
  const rayStyles = [ray0Style, ray1Style, ray2Style, ray3Style, ray4Style, ray5Style];

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.tintLayer, tintStyle]} />
      <View style={styles.content}>
        {rayStyles.map((rayStyle, i) => (
          <Animated.View key={i} style={[styles.sparkleRay, rayStyle]} />
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
    backgroundColor: "#ffd700",
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
    backgroundColor: "#ffd700",
  },
});
