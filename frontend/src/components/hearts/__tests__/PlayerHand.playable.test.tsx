import React from "react";
import { fireEvent, render } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import PlayerHand from "../PlayerHand";
import type { Card } from "../../../game/hearts/types";

// e2e/maestro/flows/hearts/ai-hand.yaml taps `hearts-hand-playable-<i>`: the
// slot testID `hearts-hand-card-<i>` is on a wrapper that is always enabled,
// so a tap on it could land on an illegal card (#2400).
const HAND: Card[] = [
  { suit: "clubs", rank: 2 },
  { suit: "clubs", rank: 9 },
  { suit: "diamonds", rank: 5 },
  { suit: "hearts", rank: 12 },
];

async function renderHand(props: Partial<React.ComponentProps<typeof PlayerHand>>) {
  return await render(
    <ThemeProvider>
      <PlayerHand hand={HAND} {...props} />
    </ThemeProvider>
  );
}

describe("PlayerHand playable testIDs (#2400)", () => {
  it("marks exactly the legal cards, and a tap on one plays a legal card", async () => {
    const onCardPress = jest.fn();
    const valid = [HAND[0]!, HAND[1]!];
    const r = await renderHand({ validCards: valid, onCardPress });
    const playable = r.queryAllByTestId(/^hearts-hand-playable-\d+$/);
    expect(playable).toHaveLength(2);
    // Every slot keeps its unconditional testID.
    expect(r.queryAllByTestId(/^hearts-hand-card-\d+$/)).toHaveLength(4);

    await fireEvent.press(playable[0]!);
    expect(onCardPress).toHaveBeenCalledTimes(1);
    const played = onCardPress.mock.calls[0][0] as Card;
    expect(valid.some((c) => c.suit === played.suit && c.rank === played.rank)).toBe(true);
  });

  it("marks nothing while no card is legal (an AI's turn)", async () => {
    const r = await renderHand({ validCards: [], onCardPress: jest.fn() });
    expect(r.queryAllByTestId(/^hearts-hand-playable-\d+$/)).toHaveLength(0);
  });

  it("marks nothing when the hand is not interactive", async () => {
    const r = await renderHand({});
    expect(r.queryAllByTestId(/^hearts-hand-playable-\d+$/)).toHaveLength(0);
  });
});
