import React from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import SharedPlayingCard from "../../../components/shared/PlayingCard";
import { useDragContext } from "./DragContext";
import { useCardSize } from "../CardSizeContext";

// 52 = CardSizeContext default card width (reference for scale factor)
const STACK_OFFSET = 24;
const REFERENCE_CARD_WIDTH = 52;

/** Floating card stack that follows the user's finger during a drag.
 *  Rendered inside DragContainer as a sibling of the game board so it
 *  is never clipped by overflow:hidden descendants. */
export function DragOverlay() {
  const { dragState, cardX, cardY } = useDragContext();
  const { cardWidth } = useCardSize();
  const scaledOffset = Math.round(STACK_OFFSET * (cardWidth / REFERENCE_CARD_WIDTH));

  const animStyle = useAnimatedStyle(() => ({
    // -8pt lifts the ghost above the fingertip so the card face stays visible.
    transform: [{ translateX: cardX.value }, { translateY: cardY.value - 8 }],
  }));

  if (!dragState) return null;

  const { cards } = dragState;

  return (
    <View style={[StyleSheet.absoluteFill, styles.overlayContainer]} pointerEvents="none">
      <Animated.View testID="drag-overlay-ghost" style={[styles.overlay, animStyle]}>
        {cards.map((card, i) => (
          <View key={i} style={[styles.card, { top: i * scaledOffset }]}>
            <SharedPlayingCard
              suit={card.suit}
              rank={card.rank}
              faceDown={card.faceDown ?? false}
              width={card.width}
              height={card.height}
            />
          </View>
        ))}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // zIndex ensures the ghost renders above all pile views on iOS.
  overlayContainer: {
    zIndex: 100,
  },
  overlay: {
    position: "absolute",
    top: 0,
    left: 0,
    // Elevation / shadow for "lifted" appearance.
    elevation: 12,
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  card: {
    position: "absolute",
  },
});
