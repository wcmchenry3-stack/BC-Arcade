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
import { useReduceMotion } from "../shared/useReduceMotion";
import { playTimedPhases } from "../shared/timedPhases";
import { useTheme } from "../../theme/ThemeContext";
import {
  HEARTS_QUEEN_CARD_FACE,
  HEARTS_QUEEN_INK,
  HEARTS_QUEEN_SHADOW,
} from "../../theme/theme.hearts";

interface Props {
  visible: boolean;
  takerLabel: string;
  onAnimationEnd: () => void;
}

export function HeartsQueenOfSpadesAnimation({ visible, takerLabel, onAnimationEnd }: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

  const overlayOpacity = useSharedValue(0);
  const cardScale = useSharedValue(0);
  const cardOpacity = useSharedValue(0);
  const cardTranslateX = useSharedValue(0);

  useEffect(() => {
    if (!visible || reduceMotion) {
      // Hidden — or reduced motion, which may have just been turned on
      // mid-sequence: clear every frame so nothing is left frozen.
      overlayOpacity.value = 0;
      cardScale.value = 0;
      cardOpacity.value = 0;
      cardTranslateX.value = 0;
      if (!visible) return;
    }

    if (reduceMotion) {
      // Reduced motion: red flash only, 0.8 s
      overlayOpacity.value = withSequence(
        withTiming(0.25, { duration: 100 }),
        withDelay(600, withTiming(0, { duration: 100 }))
      );
      return playTimedPhases({ phases: [], endAt: 800 }, onAnimationEnd);
    }

    // Phase 1 (0–200ms): spring card in + overlay fade in
    overlayOpacity.value = withTiming(0.25, { duration: 200 });
    cardOpacity.value = 1;
    cardScale.value = withSpring(1.4, { damping: 12, stiffness: 220 });

    const cancelPhases = playTimedPhases(
      {
        phases: [
          // Phase 2 (200–600ms): 4 shake iterations (translateX ±8 px)
          {
            at: 200,
            run: () => {
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
            },
          },
          // Phase 3 (700–1000ms): fade card + overlay out
          {
            at: 700,
            run: () => {
              cardOpacity.value = withTiming(0, { duration: 300 });
              cardScale.value = withTiming(0, { duration: 300 });
              overlayOpacity.value = withTiming(0, { duration: 300 });
            },
          },
        ],
        endAt: 1000,
      },
      onAnimationEnd
    );

    return () => {
      cancelPhases();
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
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.overlay,
          { backgroundColor: colors.error },
          overlayStyle,
        ]}
      />
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
    backgroundColor: HEARTS_QUEEN_CARD_FACE,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: HEARTS_QUEEN_INK,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: HEARTS_QUEEN_SHADOW,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 8,
    elevation: 8,
  },
  cardRank: {
    fontSize: 28,
    fontWeight: "800",
    color: HEARTS_QUEEN_INK,
    lineHeight: 32,
  },
  cardSuit: {
    fontSize: 24,
    color: HEARTS_QUEEN_INK,
    lineHeight: 28,
  },
});
