import React, { useEffect } from "react";
import { View, StyleSheet, useWindowDimensions } from "react-native";
import Animated, { useSharedValue, useAnimatedStyle, withSpring } from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import PlayingCard from "./PlayingCard";
import { sortHand } from "./cardSort";
import type { Card } from "../../game/hearts/types";

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

const CARD_WIDTH = 52;
const CARD_HEIGHT = 74;
const LIFT_AMOUNT = 28;
const H_PADDING = 8;

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
  const availableWidth = screenWidth - H_PADDING * 2;

  // Overlap offset so all cards fit without scroll; rightmost card is fully visible.
  const offset =
    count > 1 ? Math.min((availableWidth - CARD_WIDTH) / (count - 1), CARD_WIDTH + 4) : 0;
  const containerWidth = count > 1 ? offset * (count - 1) + CARD_WIDTH : CARD_WIDTH;

  return (
    <View
      style={[styles.wrapper, { paddingHorizontal: H_PADDING }]}
      accessibilityLabel={t("hand.player", { count })}
      accessibilityRole="none"
    >
      <View
        style={[styles.container, { width: containerWidth, height: CARD_HEIGHT + LIFT_AMOUNT }]}
      >
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
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    alignItems: "center",
  },
  container: {
    position: "relative",
  },
  cardSlot: {
    position: "absolute",
    top: LIFT_AMOUNT,
  },
});
