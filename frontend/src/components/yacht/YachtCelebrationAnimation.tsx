import React, { useEffect, useRef } from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import { AnimationOverlay } from "../shared/AnimationOverlay";
import { BADGE_JOKER_BG, BADGE_YACHT_BG } from "../../theme/theme.constants";

interface Props {
  visible: boolean;
  onDismiss: () => void;
  variant?: "yacht" | "joker";
}

// Emoji dice scattered around the badge (emoji layer renders consistently on all platforms)
const DIE_FACES = ["🎲", "🎲", "🎲", "🎲", "🎲", "🎲", "🎲", "🎲"] as const;
const FACE_OFFSETS = [
  { x: -110, y: -110 },
  { x: 110, y: -110 },
  { x: -130, y: 10 },
  { x: 130, y: 10 },
  { x: -90, y: 110 },
  { x: 90, y: 110 },
  { x: -20, y: -140 },
  { x: 20, y: 140 },
] as const;

export function YachtCelebrationAnimation({ visible, onDismiss, variant = "yacht" }: Props) {
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  const badgeScale = useSharedValue(0);
  const badgeOpacity = useSharedValue(0);

  const face0 = useSharedValue(0);
  const face1 = useSharedValue(0);
  const face2 = useSharedValue(0);
  const face3 = useSharedValue(0);
  const face4 = useSharedValue(0);
  const face5 = useSharedValue(0);
  const face6 = useSharedValue(0);
  const face7 = useSharedValue(0);
  const faces = [face0, face1, face2, face3, face4, face5, face6, face7];

  useEffect(() => {
    timersRef.current.forEach(clearTimeout);
    timersRef.current = [];

    if (!visible) {
      badgeScale.value = 0;
      badgeOpacity.value = 0;
      faces.forEach((f) => {
        f.value = 0;
      });
      cancelAnimation(badgeScale);
      cancelAnimation(badgeOpacity);
      faces.forEach((f) => cancelAnimation(f));
      return;
    }

    // Phase 1 — burst (0–600 ms)
    badgeScale.value = withSpring(1, { damping: 9, stiffness: 130 });
    badgeOpacity.value = withTiming(1, { duration: 300 });
    faces.forEach((f, i) => {
      f.value = withDelay(i * 45, withSpring(1, { damping: 7, stiffness: 110 }));
    });

    // Phase 2 — fade out after lingering
    const t1 = setTimeout(() => {
      badgeOpacity.value = withTiming(0, { duration: 500 });
      faces.forEach((f) => {
        f.value = withTiming(0, { duration: 400 });
      });
    }, 2200);
    const t2 = setTimeout(onDismiss, 2800);
    timersRef.current.push(t1, t2);

    return () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const badgeStyle = useAnimatedStyle(() => ({
    transform: [{ scale: badgeScale.value }],
    opacity: badgeOpacity.value,
  }));

  const faceStyles = faces.map((f) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useAnimatedStyle(() => ({ opacity: f.value, transform: [{ scale: f.value }] }))
  );

  return (
    <AnimationOverlay visible={visible} onDismiss={onDismiss}>
      <View style={styles.content} pointerEvents="none">
        {FACE_OFFSETS.map((offset, i) => (
          <Animated.Text
            key={i}
            style={[
              styles.dieFace,
              {
                left: "50%",
                top: "50%",
                marginLeft: offset.x - 16,
                marginTop: offset.y - 16,
              },
              faceStyles[i],
            ]}
          >
            {DIE_FACES[i]}
          </Animated.Text>
        ))}
        <Animated.View
          style={[
            styles.badge,
            variant === "joker" ? styles.badgeJoker : styles.badgeYacht,
            badgeStyle,
          ]}
        >
          <Text
            style={styles.badgeText}
            accessibilityRole="text"
            accessibilityLiveRegion="assertive"
          >
            {variant === "joker" ? "JOKER!" : "YACHT!"}
          </Text>
        </Animated.View>
      </View>
    </AnimationOverlay>
  );
}

const styles = StyleSheet.create({
  content: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  badge: {
    borderRadius: 20,
    paddingHorizontal: 40,
    paddingVertical: 18,
  },
  badgeYacht: {
    backgroundColor: BADGE_YACHT_BG,
  },
  badgeJoker: {
    backgroundColor: BADGE_JOKER_BG,
  },
  badgeText: {
    fontSize: 42,
    fontWeight: "900",
    color: "#1a1a1a",
    letterSpacing: 3,
    textTransform: "uppercase",
  },
  dieFace: {
    position: "absolute",
    fontSize: 32,
  },
});
