import React, { useEffect, useMemo } from "react";
import { View, Text, StyleSheet, useWindowDimensions } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useReduceMotion } from "../shared/useReduceMotion";
import { useTranslation } from "react-i18next";
import PlayingCard from "./PlayingCard";
import { sortHand } from "./cardSort";
import {
  computeHandPoses,
  computeFallbackGeometry,
  type HandGeometry,
} from "../../game/hearts/layout";
import type { Card } from "../../game/hearts/types";

interface Props {
  hand: Card[];
  selectedCards?: Card[];
  validCards?: Card[];
  onCardPress?: (card: Card) => void;
  /** The fan's size and arc on the card table (#3587); fitted to the window when omitted. */
  geometry?: HandGeometry;
}

function inSet(cards: Card[] | undefined, card: Card): boolean {
  if (!cards) return false;
  return cards.some((c) => c.suit === card.suit && c.rank === card.rank);
}

function cardKey(c: Card): string {
  return `${c.suit}-${c.rank}`;
}

// Springy overshoot approximating the design's cubic-bezier(0.34, 1.56, 0.64, 1).
const LIFT_SPRING = { mass: 0.5, damping: 11, stiffness: 180 } as const;

function AnimatedCardSlot({
  card,
  left,
  top,
  rotation,
  width,
  height,
  zIndex,
  rise,
  highlighted,
  disabled,
  onPress,
  testID,
  playableTestID,
}: {
  card: Card;
  left: number;
  top: number;
  rotation: number;
  width: number;
  height: number;
  zIndex: number;
  /** How far the card stands above its place in the arc: 0, the playable raise or the selected lift. */
  rise: number;
  highlighted: boolean;
  disabled: boolean;
  onPress: (() => void) | undefined;
  testID?: string;
  /** Set only while the card can be played (Maestro taps it, #2400). */
  playableTestID?: string;
}) {
  const translateY = useSharedValue(-rise);
  // Reduce Motion: the card stands at its height at once, no spring (review of #3608).
  const reduceMotion = useReduceMotion();

  useEffect(() => {
    translateY.value = reduceMotion ? -rise : withSpring(-rise, LIFT_SPRING);
  }, [rise, translateY, reduceMotion]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View
      testID={testID}
      style={[styles.cardSlot, { left, top, width, height, zIndex }, animStyle]}
    >
      <PlayingCard
        card={card}
        highlighted={highlighted}
        disabled={disabled}
        onPress={onPress}
        testID={playableTestID}
        width={width}
        height={height}
        rotation={rotation}
      />
    </Animated.View>
  );
}

/**
 * The human's hand as a gentle fan (#3587): an even spread of cards, tilted and dropped toward
 * the ends along a shallow arc. A playable card stands a little above the arc, an unplayable
 * one is dimmed, and a card chosen for passing lifts further.
 */
export default function PlayerHand({
  hand,
  selectedCards,
  validCards,
  onCardPress,
  geometry,
}: Props) {
  const { t } = useTranslation("hearts");
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const fan = useMemo(
    () => geometry ?? computeFallbackGeometry({ width: screenWidth, height: screenHeight }).hand,
    [geometry, screenWidth, screenHeight]
  );

  const sorted = sortHand(hand);
  const count = sorted.length;
  const poses = computeHandPoses(fan, count);

  return (
    <View
      style={{ width: fan.rect.w, height: fan.rect.h }}
      accessibilityLabel={t("hand.player", { count })}
      accessibilityRole="none"
    >
      {/* Non-touchable Views default to accessible=false on Android, so the
          wrapper's own accessibilityLabel above is never exposed to the
          native accessibility tree (confirmed: CI's hearts/ai-hand.yaml
          could never find "Your hand, N cards", at any timeout, on run
          33286208569). Marking the wrapper itself accessible={true} would
          fix that but merges all descendants into one node, hiding each
          card's individual Pressable from screen readers *and* from
          Maestro's per-card `id` taps this same flow depends on — so a
          real, separately-exposed Text carries the label instead, mirroring
          TrickArea.tsx's identical srOnly pattern for the same conflict
          (a labeled region whose children must stay independently
          accessible). */}
      <Text style={styles.srOnly}>{t("hand.player", { count })}</Text>
      {sorted.map((card, i) => {
        const pose = poses[i]!;
        const highlighted = inSet(selectedCards, card);
        const disabled = validCards !== undefined && !inSet(validCards, card);
        const playable = onCardPress !== undefined && validCards !== undefined && !disabled;
        return (
          <AnimatedCardSlot
            key={cardKey(card)}
            testID={`hearts-hand-card-${i}`}
            // The slot's testID above never reflects legality (the slot is a
            // plain wrapper), so e2e flows tap a legal card through this one:
            // present only on an enabled, pressable card (#2400).
            playableTestID={onCardPress && !disabled ? `hearts-hand-playable-${i}` : undefined}
            card={card}
            left={pose.x}
            top={pose.y}
            rotation={pose.rotation}
            width={fan.cardW}
            height={fan.cardH}
            zIndex={i}
            rise={highlighted ? fan.selectLift : playable ? fan.raise : 0}
            highlighted={highlighted}
            disabled={disabled}
            onPress={onCardPress ? () => onCardPress(card) : undefined}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  cardSlot: {
    position: "absolute",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
