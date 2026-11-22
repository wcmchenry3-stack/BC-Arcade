import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import Animated from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { AnimationOverlay } from "../shared/AnimationOverlay";
import { useCelebration } from "../shared/useCelebration";
import { BADGE_JOKER_BG, BADGE_TEXT, BADGE_YACHT_BG } from "../../theme/theme.constants";
import {
  JACKPOT_BADGE_FADE_OUT_MS,
  JACKPOT_DONE_MS,
  JACKPOT_EXIT_AT_MS,
  JACKPOT_PARTICLE_FADE_OUT_MS,
  JACKPOT_PARTICLE_STAGGER_MS,
  JACKPOT_REDUCED_DONE_MS,
} from "../../game/yacht/motion";

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

/** The badge's side padding (pt) and the screen margin kept clear of it. */
const BADGE_PAD_H = 24;
const SCREEN_MARGIN = 16;
const MAX_FONT = 42;

/**
 * The word's font size: 42 pt where it fits, smaller where it doesn't (a longer word in another
 * language on a 320 pt phone must not spill off the badge or the screen).
 */
export function celebrationFontSize(text: string, windowWidth: number): number {
  const room = windowWidth - 2 * SCREEN_MARGIN - 2 * BADGE_PAD_H;
  // A capital is about 0.78 em wide with the letter spacing below.
  return Math.max(20, Math.min(MAX_FONT, Math.floor(room / (Math.max(text.length, 1) * 0.78))));
}

export function YachtCelebrationAnimation({ visible, onDismiss, variant = "yacht" }: Props) {
  const { t } = useTranslation("yacht");
  const { width } = useWindowDimensions();
  const word = t(variant === "joker" ? "celebration.joker" : "celebration.yacht");
  const fontSize = celebrationFontSize(word, width);
  const { badgeStyle, particleStyles: faceStyles } = useCelebration({
    visible,
    particleCount: FACE_OFFSETS.length,
    onDone: onDismiss,
    badgeSpring: { damping: 9, stiffness: 130 },
    particleSpring: { damping: 7, stiffness: 110 },
    particleStaggerMs: JACKPOT_PARTICLE_STAGGER_MS,
    exitAtMs: JACKPOT_EXIT_AT_MS,
    doneAtMs: JACKPOT_DONE_MS,
    badgeFadeOutMs: JACKPOT_BADGE_FADE_OUT_MS,
    particleFadeOutMs: JACKPOT_PARTICLE_FADE_OUT_MS,
    // Reduce Motion: show the badge and dice still, then dismiss.
    reducedMotion: { mode: "static", doneAfterMs: JACKPOT_REDUCED_DONE_MS },
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
            style={[styles.badgeText, { fontSize, letterSpacing: Math.round(fontSize / 14) }]}
            numberOfLines={1}
            accessibilityRole="text"
            accessibilityLiveRegion="assertive"
            testID="yacht-celebration-text"
          >
            {word}
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
    paddingHorizontal: BADGE_PAD_H,
    paddingVertical: 18,
  },
  badgeYacht: {
    backgroundColor: BADGE_YACHT_BG,
  },
  badgeJoker: {
    backgroundColor: BADGE_JOKER_BG,
  },
  badgeText: {
    fontWeight: "900",
    color: BADGE_TEXT,
    textTransform: "uppercase",
  },
  dieFace: {
    position: "absolute",
    fontSize: 32,
  },
});
