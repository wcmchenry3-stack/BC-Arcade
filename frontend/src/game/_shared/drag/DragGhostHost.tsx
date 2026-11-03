import React, { useLayoutEffect, useSyncExternalStore } from "react";
import { StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import SharedPlayingCard from "../../../components/shared/PlayingCard";
import { CARD_SHADOW } from "../../../theme/theme.cards";
import { GHOST_LIFT } from "./dragGeometry";
import { getGhost, subscribeGhost } from "./ghostHost";
import type { GhostHostDrag } from "./ghostHost";

// Fan for a multi-card drag whose cards carry no `stackTop` (every tableau
// run passes its pile's real offsets, #3531): 24 px at Solitaire's natural
// 52 px card width, scaled with the card.
const FALLBACK_STACK_OFFSET = 24;
const REFERENCE_CARD_WIDTH = 52;

/**
 * The drag ghost's root host (#3531): a full-window, `pointerEvents="none"`
 * layer mounted once at the app root, inside `GestureHandlerRootView` and
 * after the navigator (App.tsx), so it draws above the screens and is never
 * clipped by a board's `overflow: hidden` or scrolled with a ScrollView.
 *
 * Its origin is RNGH's absolute origin, so the ghost is placed straight from
 * the finger: `translate = (cardX, cardY − GHOST_LIFT)` with
 * `cardX/Y = finger − grab` (DraggableCard). Renders nothing while no drag is
 * active, so it can never cover a modal between drags.
 */
export function DragGhostHost() {
  const drag = useSyncExternalStore(subscribeGhost, getGhost, getGhost);
  if (!drag) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.host]} pointerEvents="none">
      <Ghost drag={drag} />
    </View>
  );
}

function Ghost({ drag }: { drag: GhostHostDrag }) {
  const { cards, cardX, cardY, ghostRef, ghostMounted } = drag;

  const animStyle = useAnimatedStyle(() => ({
    // GHOST_LIFT (8pt) lifts the ghost above the fingertip so the card face
    // stays visible. DraggableCard's ghost check (#3528) accounts for it.
    transform: [{ translateX: cardX.value }, { translateY: cardY.value - GHOST_LIFT }],
  }));

  // Tell the ghost check (#3528) the ghost view exists, so it never measures
  // a ref that is still null (before the first mount, measure() throws on the
  // UI thread) or stale (after unmount, it returns null and warns). A
  // follow-on drag keeps the same view mounted, so this only flips at the
  // edges of a drag sequence.
  useLayoutEffect(() => {
    ghostMounted.value = true;
    return () => {
      ghostMounted.value = false;
    };
  }, [ghostMounted]);

  return (
    // ghostRef: DraggableCard measures this view once per drag to check it is
    // rendered under the finger (#3528).
    <Animated.View ref={ghostRef} testID="drag-overlay-ghost" style={[styles.ghost, animStyle]}>
      {cards.map((card, i) => (
        <View
          key={i}
          testID={`drag-overlay-ghost-card-${i}`}
          style={[
            styles.card,
            {
              top:
                card.stackTop ??
                i * Math.round(FALLBACK_STACK_OFFSET * (card.width / REFERENCE_CARD_WIDTH)),
            },
          ]}
        >
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
  );
}

const styles = StyleSheet.create({
  // Last child of the root view, so it already draws above the navigator;
  // zIndex keeps it there on web.
  host: {
    zIndex: 1000,
  },
  ghost: {
    position: "absolute",
    top: 0,
    left: 0,
    // Elevation / shadow for "lifted" appearance.
    elevation: 12,
    shadowColor: CARD_SHADOW,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
  },
  card: {
    position: "absolute",
  },
});
