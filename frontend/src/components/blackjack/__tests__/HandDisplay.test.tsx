import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import HandDisplay from "../HandDisplay";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { calculateBlackjackLayout } from "../../../game/blackjack/layout";
import type { HandResponse } from "../../../game/blackjack/types";

const RANKS = ["2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q"];

function makeHand(count: number): HandResponse {
  return {
    cards: Array.from({ length: count }, (_, i) => ({
      rank: RANKS[i % RANKS.length] as string,
      suit: "♠",
      face_down: false,
    })),
    value: 20,
    soft: false,
  };
}

const NORMAL = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 800 });
const COMPACT = calculateBlackjackLayout({ availableWidth: 390, availableHeight: 600 });
const NARROW = calculateBlackjackLayout({ availableWidth: 320, availableHeight: 600 });

async function renderHand(
  count: number,
  cardWidth: number,
  rowWidth: number,
  variant: "player" | "dealer" = "player"
) {
  const utils = await render(
    <ThemeProvider>
      <HandDisplay
        hand={makeHand(count)}
        label="Hand"
        variant={variant}
        cardWidth={cardWidth}
        cardHeight={Math.round(cardWidth * 1.4)}
        rowWidth={rowWidth}
      />
    </ThemeProvider>
  );
  const row = utils.getByTestId("hand-row");
  const children = row.children as unknown as { props: { style?: unknown } }[];
  const margins = children.map(
    (c) => (StyleSheet.flatten(c.props.style as object) as { marginLeft?: number })?.marginLeft ?? 0
  );
  // Right edge of the last card relative to the row's left edge.
  const span = cardWidth + margins.slice(1).reduce((sum, m) => sum + cardWidth + m, 0);
  return { ...utils, count: children.length, margins, span };
}

describe("HandDisplay overlap", () => {
  it("keeps a short hand side by side with no overlap", async () => {
    const { margins, count } = await renderHand(3, NORMAL.playerCardWidth, NORMAL.handRowWidth);
    expect(count).toBe(3);
    expect(margins.every((m) => m === 0)).toBe(true);
  });

  const cases: [string, typeof NORMAL, "player" | "dealer"][] = [
    ["normal player", NORMAL, "player"],
    ["compact player", COMPACT, "player"],
    ["narrow player", NARROW, "player"],
    ["normal dealer", NORMAL, "dealer"],
    ["compact dealer", COMPACT, "dealer"],
  ];

  describe.each(cases)("%s hand", (_name, layout, variant) => {
    const cardWidth = variant === "player" ? layout.playerCardWidth : layout.dealerCardWidth;

    it.each([6, 7, 11])("renders %i cards on one row, all visible within the row", async (n) => {
      const { count, margins, span } = await renderHand(n, cardWidth, layout.handRowWidth, variant);
      expect(count).toBe(n);
      expect(span).toBeLessThanOrEqual(layout.handRowWidth);
      // Each card keeps a visible strip, and the last card is not covered.
      for (const m of margins.slice(1)) expect(cardWidth + m).toBeGreaterThan(0);
    });
  });

  it("does not overflow with 11 cards in a split hand (normal, compact, narrow)", async () => {
    for (const layout of [NORMAL, COMPACT, NARROW]) {
      const r = await renderHand(11, layout.splitCardWidth, layout.splitHandRowWidth);
      expect(r.span).toBeLessThanOrEqual(layout.splitHandRowWidth);
      expect(r.count).toBe(11);
    }
  });

  it("overlaps a split hand with 5 cards when they do not fit", async () => {
    const r = await renderHand(5, NARROW.splitCardWidth, NARROW.splitHandRowWidth);
    expect(r.span).toBeLessThanOrEqual(NARROW.splitHandRowWidth);
    expect(r.margins.slice(1).every((m) => m < 0)).toBe(true);
  });

  it("renders the last drawn card", async () => {
    const { getAllByText } = await renderHand(11, NORMAL.playerCardWidth, NORMAL.handRowWidth);
    expect(getAllByText("Q").length).toBeGreaterThan(0);
  });
});
