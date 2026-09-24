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
  takerLabel: string;
  onAnimationEnd: () => void;
}

export function HeartsQueenOfSpadesAnimation({ visible, takerLabel, onAnimationEnd }: Props) {
  const { t } = useTranslation("hearts");
  const [reduceMotion, setReduceMotion] = useState(false);
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const overlayOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0);
  const cardOpacity = useSharedValue(0);
  const cardTranslateX = useSharedValue(0);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  useEffect(() => {
    if (!visible) {
      overlayOpacity.value = 0;
      cardScale.value = 0;
      cardOpacity.value = 0;
      cardTranslateX.value = 0;
      return;
    }

    if (reduceMotion) {
      // Reduced motion: red flash only, 0.8 s
      overlayOpacity.value = withSequence(
        withTiming(0.25, { duration: 100 }),
        withDelay(600, withTiming(0, { duration: 100 }))
      );
      const t1 = setTimeout(onAnimationEnd, 800);
      timersRef.current.push(t1);
      return () => {
        clearTimeout(t1);
        timersRef.current = [];
      };
    }

    // Phase 1 (0–200ms): spring card in + overlay fade in
    overlayOpacity.value = withTiming(0.25, { duration: 200 });
    cardOpacity.value = 1;
    cardScale.value = withSpring(1.4, { damping: 12, stiffness: 220 });

    // Phase 2 (200–600ms): 4 shake iterations (translateX ±8 px)
    const t1 = setTimeout(() => {
      cardTranslateX.value = withSequence(
        withTiming(8, { duration: 50 }),
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 50 }),
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 50 }),
        withTiming(-8, { duration: 50 }),
        withTiming(8, { duration: 50 }),
        withTiming(-8, { duration: 50 }),
        withTiming(0, { duration: 50 })
      );
    }, 200);

    // Phase 3 (700–1000ms): fade card + overlay out
    const t2 = setTimeout(() => {
      cardOpacity.value = withTiming(0, { duration: 300 });
      cardScale.value = withTiming(0, { duration: 300 });
      overlayOpacity.value = withTiming(0, { duration: 300 });
    }, 700);

    const t3 = setTimeout(onAnimationEnd, 1000);
    timersRef.current.push(t1, t2, t3);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      cancelAnimation(overlayOpacity);
      cancelAnimation(cardScale);
      cancelAnimation(cardOpacity);
      cancelAnimation(cardTranslateX);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, reduceMotion]);

  const overlayStyle = useAnimatedStyle(() => ({ opacity: overlayOpacity.value }));
  const cardStyle = useAnimatedStyle(() => ({
    transform: [{ scale: cardScale.value }, { translateX: cardTranslateX.value }],
    opacity: cardOpacity.value,
  }));

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[StyleSheet.absoluteFill, styles.overlay, overlayStyle]} />
      <View style={styles.content}>
        <Animated.View
          style={[styles.card, cardStyle]}
          accessibilityLabel={t("events.queenOfSpades", { name: takerLabel })}
          accessibilityRole="text"
          accessibilityLiveRegion="polite"
        >
          <Animated.Text style={styles.cardRank}>Q</Animated.Text>
          <Animated.Text style={styles.cardSuit}>♠</Animated.Text>
        </Animated.View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    backgroundColor: "#dc2626",
    zIndex: 100,
  },
  content: {
    ...StyleSheet.absoluteFill,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 101,
  },
  card: {
    width: 72,
    height: 100,
    backgroundColor: "#ffffff",
    borderRadius: 10,
    borderWidth: 2,
    borderColor: "#1e1b4b",
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  cardRank: {
    fontSize: 28,
    fontWeight: "800",
    color: "#1e1b4b",
    lineHeight: 32,
  },
  cardSuit: {
    fontSize: 24,
    color: "#1e1b4b",
    lineHeight: 28,
  },
});
