/**
 * FannedHand — one hand's cards fanned left to right so each shows its corner
 * index (#3580). Positions come from the table geometry (game/blackjack/layout.ts).
 *
 * Each card is keyed by its place in the hand (`<id>-<n>`): cards are only ever
 * added to the end of a hand, so a card keeps its component from the deal to
 * the result, and the hole card is the same component face down and face up.
 * That is what lets card motion (#3581) animate a card instead of remounting it.
 */
import React from "react";
import { View, StyleSheet } from "react-native";
import type { CardResponse } from "../../game/blackjack/types";
import type { FanGeometry } from "../../game/blackjack/layout";
import PlayingCard from "./PlayingCard";

interface Props {
  cards: readonly CardResponse[];
  fan: FanGeometry;
  /** Stable id of the hand ("dealer", "hand-0" ...): prefixes each card's key and testID. */
  id: string;
  /** Dim the cards (a split hand already played). */
  dimmed?: boolean;
}

function FannedHand({ cards, fan, id, dimmed = false }: Props) {
  return (
    <>
      {cards.map((card, i) => (
        <View
          key={`${id}-${i}`}
          testID={`${id}-card-${i}`}
          style={[
            styles.card,
            {
              left: fan.x + i * fan.step,
              top: fan.y,
              width: fan.cardWidth,
              height: fan.cardHeight,
            },
          ]}
        >
          <PlayingCard
            card={card}
            width={fan.cardWidth}
            height={fan.cardHeight}
            disabled={dimmed}
          />
        </View>
      ))}
    </>
  );
}

const styles = StyleSheet.create({
  card: {
    position: "absolute",
  },
});

export default React.memo(FannedHand);
