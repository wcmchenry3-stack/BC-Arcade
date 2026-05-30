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
import { useTranslation } from "react-i18next";

interface Props {
  visible: boolean;
  onAnimationEnd: () => void;
}

// Six crack lines at 30° intervals radiating outward
const CRACK_ANGLES = [0, 30, 60, 90, 120, 150] as const;

export function HeartsBrokenAnimation({ visible, onAnimationEnd }: Props) {
  const { t } = useTranslation("hearts");
  const [reduceMotion, setReduceMotion] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const iconScale = useSharedValue(0);
  const iconOpacity = useSharedValue(0);
  // Tint opacity: 0 → 0.3 → 0.08 (hold) → 0 (fade out)
  const tintOpacity = useSharedValue(0);

  // One shared value per crack line — hooks cannot be called in a loop
  const crack0 = useSharedValue(0);
  const crack1 = useSharedValue(0);
  const crack2 = useSharedValue(0);
  const crack3 = useSharedValue(0);
  const crack4 = useSharedValue(0);
  const crack5 = useSharedValue(0);
  const cracks = [crack0, crack1, crack2, crack3, crack4, crack5];

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!visible) {
      iconScale.value = 0;
      iconOpacity.value = 0;
      tintOpacity.value = 0;
      cracks.forEach((c) => {
        c.value = 0;
      });
      return;
    }

    if (reduceMotion) {
      // Reduced motion: instant red tint flash only, ~0.3 s total
      tintOpacity.value = withSequence(
        withTiming(0.3, { duration: 50 }),
        withDelay(200, withTiming(0, { duration: 50 }))
      );
      const t1 = setTimeout(onAnimationEnd, 300);
      timersRef.current.push(t1);
      return () => {
        clearTimeout(t1);
        timersRef.current = [];
      };
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
    cracks.forEach((c, i) => {
      c.value = withDelay(i * 60, withTiming(1, { duration: 300 }));
    });

    // Phase 2 — linger: icon fades to reduced opacity after burst peak
    const t1 = setTimeout(() => {
      iconOpacity.value = withTiming(0.25, { duration: 200 });
    }, 800);

    // Phase 3 — fade everything out at ~2900 ms (total ~3.4 s)
    const t2 = setTimeout(() => {
      iconOpacity.value = withTiming(0, { duration: 500 });
      tintOpacity.value = withTiming(0, { duration: 500 });
      iconScale.value = withTiming(0, { duration: 500 });
      cracks.forEach((c) => {
        c.value = withTiming(0, { duration: 400 });
      });
    }, 2900);

    const t3 = setTimeout(onAnimationEnd, 3400);
    timersRef.current.push(t1, t2, t3);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      cancelAnimation(iconScale);
      cancelAnimation(iconOpacity);
      cancelAnimation(tintOpacity);
      cracks.forEach((c) => cancelAnimation(c));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  // Tint layer uses its own opacity so it does not affect child elements
  const tintStyle = useAnimatedStyle(() => ({ opacity: tintOpacity.value }));
  const iconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: iconScale.value }],
    opacity: iconOpacity.value,
  }));
  const crack0Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${CRACK_ANGLES[0]}deg` }, { scaleX: crack0.value }],
    opacity: crack0.value,
    transformOrigin: "center",
  }));
  const crack1Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${CRACK_ANGLES[1]}deg` }, { scaleX: crack1.value }],
    opacity: crack1.value,
    transformOrigin: "center",
  }));
  const crack2Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${CRACK_ANGLES[2]}deg` }, { scaleX: crack2.value }],
    opacity: crack2.value,
    transformOrigin: "center",
  }));
  const crack3Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${CRACK_ANGLES[3]}deg` }, { scaleX: crack3.value }],
    opacity: crack3.value,
    transformOrigin: "center",
  }));
  const crack4Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${CRACK_ANGLES[4]}deg` }, { scaleX: crack4.value }],
    opacity: crack4.value,
    transformOrigin: "center",
  }));
  const crack5Style = useAnimatedStyle(() => ({
    transform: [{ rotate: `${CRACK_ANGLES[5]}deg` }, { scaleX: crack5.value }],
    opacity: crack5.value,
    transformOrigin: "center",
  }));
  const crackStyles = [
    crack0Style,
    crack1Style,
    crack2Style,
    crack3Style,
    crack4Style,
    crack5Style,
  ];

  return (
    // Non-interactive wrapper — never blocks touches
    <View style={StyleSheet.absoluteFillObject} pointerEvents="none">
      {/* Red tint layer — separate from content so its opacity does not bleed into children */}
      <Animated.View style={[StyleSheet.absoluteFillObject, styles.tintLayer, tintStyle]} />
      {/* Content: heart icon + radiating crack lines */}
      <View style={styles.content}>
        {crackStyles.map((crackStyle, i) => (
          <Animated.View key={i} style={[styles.crackLine, crackStyle]} />
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
    ...StyleSheet.absoluteFillObject,
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
