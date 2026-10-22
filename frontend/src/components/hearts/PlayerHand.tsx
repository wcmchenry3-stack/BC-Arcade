import React, { useEffect } from "react";
import { View, Text, ScrollView, StyleSheet, useWindowDimensions } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import PlayingCard from "./PlayingCard";
import { sortHand } from "./cardSort";
import type { Card } from "../../game/hearts/types";
import { CARD_NATURAL_H, CARD_NATURAL_W } from "../../game/_shared/CardSizeContext";

interface Props {
  hand: Card[];
  selectedCards?: Card[];
  validCards?: Card[];
  onCardPress?: (card: Card) => void;
}

function inSet(cards: Card[] | undefined, card: Card): boolean {
  if (!cards) return false;
  return cards.some((c) => c.suit === card.suit && c.rank === card.rank);
}

function cardKey(c: Card): string {
  return `${c.suit}-${c.rank}`;
}

const CARD_WIDTH = CARD_NATURAL_W;
const CARD_HEIGHT = CARD_NATURAL_H;
const LIFT_AMOUNT = 28;
const H_PADDING = 8;

/** Minimum exposed width per overlapped card (dp) - WCAG 2.2 AA 2.5.8 target size. */
export const MIN_CARD_OFFSET = 24;

export interface HandLayout {
  offset: number;
  containerWidth: number;
  scrollable: boolean;
}

/**
 * Overlap layout for the hand. The offset is floored at MIN_CARD_OFFSET so each
 * card keeps a 24dp touch target; when the floored hand is wider than the
 * available space, `scrollable` is true and the caller wraps it in a
 * horizontal ScrollView.
 */
export function computeHandLayout(screenWidth: number, count: number): HandLayout {
  const availableWidth = screenWidth - H_PADDING * 2;
  const offset =
    count > 1
      ? Math.max(
          MIN_CARD_OFFSET,
          Math.min((availableWidth - CARD_WIDTH) / (count - 1), CARD_WIDTH + 4)
        )
      : 0;
  const containerWidth = count > 1 ? offset * (count - 1) + CARD_WIDTH : CARD_WIDTH;
  return { offset, containerWidth, scrollable: containerWidth > availableWidth };
}

// Springy overshoot approximating the design's cubic-bezier(0.34, 1.56, 0.64, 1).
const LIFT_SPRING = { mass: 0.5, damping: 11, stiffness: 180 } as const;

function AnimatedCardSlot({
  card,
  left,
  zIndex,
  lifted,
  highlighted,
  disabled,
  onPress,
  testID,
}: {
  card: Card;
  left: number;
  zIndex: number;
  lifted: boolean;
  highlighted: boolean;
  disabled: boolean;
  onPress: (() => void) | undefined;
  testID?: string;
}) {
  const translateY = useSharedValue(lifted ? -LIFT_AMOUNT : 0);

  useEffect(() => {
    translateY.value = withSpring(lifted ? -LIFT_AMOUNT : 0, LIFT_SPRING);
  }, [lifted, translateY]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: translateY.value }],
  }));

  return (
    <Animated.View testID={testID} style={[styles.cardSlot, { left, zIndex }, animStyle]}>
      <PlayingCard card={card} highlighted={highlighted} disabled={disabled} onPress={onPress} />
    </Animated.View>
  );
}

export default function PlayerHand({ hand, selectedCards, validCards, onCardPress }: Props) {
  const { t } = useTranslation("hearts");
  const { width: screenWidth } = useWindowDimensions();

  const sorted = sortHand(hand);
  const count = sorted.length;
  const { offset, containerWidth, scrollable } = computeHandLayout(screenWidth, count);

  const cards = (
    <View style={[styles.container, { width: containerWidth, height: CARD_HEIGHT + LIFT_AMOUNT }]}>
      {sorted.map((card, i) => {
        const highlighted = inSet(selectedCards, card);
        const disabled = validCards !== undefined && !inSet(validCards, card);
        return (
          <AnimatedCardSlot
            key={cardKey(card)}
            testID={`hearts-hand-card-${i}`}
            card={card}
            left={i * offset}
            zIndex={i}
            lifted={highlighted}
            highlighted={highlighted}
            disabled={disabled}
            onPress={onCardPress ? () => onCardPress(card) : undefined}
          />
        );
      })}
    </View>
  );

  return (
    <View
      style={[styles.wrapper, { paddingHorizontal: H_PADDING }]}
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
      {scrollable ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator
          testID="hearts-hand-scroll"
          style={styles.scroll}
        >
          {cards}
        </ScrollView>
      ) : (
        cards
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
  },
  scroll: {
    alignSelf: "stretch",
  },
  container: {
    position: "relative",
  },
  cardSlot: {
    position: "absolute",
    top: LIFT_AMOUNT,
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
