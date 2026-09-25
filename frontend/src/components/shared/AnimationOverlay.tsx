import React, { useEffect } from "react";
import { Pressable, StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from "react-native-reanimated";
import { useReduceMotion } from "./useReduceMotion";

interface AnimationOverlayProps {
  visible: boolean;
  onDismiss: () => void;
  children?: React.ReactNode;
}

export function AnimationOverlay({ visible, onDismiss, children }: AnimationOverlayProps) {
  const { t } = useTranslation("result");
  const reduceMotion = useReduceMotion();
  const opacity = useSharedValue(0);

  useEffect(() => {
    const target = visible ? 1 : 0;
    if (reduceMotion) {
      opacity.value = target;
    } else {
      opacity.value = withTiming(target, { duration: visible ? 300 : 200 });
    }
  }, [visible, reduceMotion, opacity]);

  const animatedStyle = useAnimatedStyle(() => ({ opacity: opacity.value }));

  // The overlay stays mounted while hidden (opacity 0), so it is hidden from
  // screen readers then (aria-hidden); when shown, the full-screen backdrop is
  // the skip button (#2711).
  const backdrop = (
    <Pressable
      style={StyleSheet.absoluteFill}
      onPress={onDismiss}
      accessibilityRole="button"
      accessibilityLabel={t("a11y.dismissCelebration")}
    />
  );

  // Reduced-motion: instant static tint, no animated motion.
  if (reduceMotion) {
    return (
      <View
        style={[styles.overlay, { opacity: visible ? 1 : 0 }]}
        pointerEvents={visible ? "auto" : "none"}
        testID="animation-overlay-static"
        aria-hidden={!visible}
      >
        {backdrop}
        {children}
      </View>
    );
  }

  return (
    <Animated.View
      style={[styles.overlay, animatedStyle]}
      pointerEvents={visible ? "auto" : "none"}
      testID="animation-overlay"
      aria-hidden={!visible}
    >
      {backdrop}
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    zIndex: 999,
    justifyContent: "center",
    alignItems: "center",
  },
});
