import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { AnimationOverlay } from "../shared/AnimationOverlay";
import { useCelebration } from "../shared/useCelebration";
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
  const { badgeStyle, particleStyles: faceStyles } = useCelebration({
    visible,
    particleCount: FACE_OFFSETS.length,
    onDone: onDismiss,
    badgeSpring: { damping: 9, stiffness: 130 },
    particleSpring: { damping: 7, stiffness: 110 },
    particleStaggerMs: 45,
    exitAtMs: 2200,
    doneAtMs: 2800,
    badgeFadeOutMs: 500,
    particleFadeOutMs: 400,
    // Reduce Motion: show the badge and dice still, then dismiss.
    reducedMotion: { mode: "static", doneAfterMs: 1500 },
  });

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
