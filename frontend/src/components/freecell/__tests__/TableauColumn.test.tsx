/**
 * #1108 — tall FreeCell tableau columns compress to fit instead of running
 * off the bottom of the screen.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import { CardSizeContext } from "../../../game/_shared/CardSizeContext";
import { DragProvider } from "../../../game/_shared/drag/DragContext";
import TableauColumn, {
  computeCardOffset,
  FACE_UP_OFFSET,
  MIN_FACE_UP_OFFSET,
  TABLEAU_MAX_HEIGHT,
} from "../TableauColumn";
import { CARD_HEIGHT, CARD_WIDTH } from "../FreeCellSlot";
import type { Card } from "../../../game/freecell/types";

const SUITS = ["spades", "hearts", "clubs", "diamonds"] as const;
function pileOf(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({ suit: SUITS[i % 4]!, rank: (i % 13) + 1 }));
}

describe("computeCardOffset (#1108)", () => {
  it("budget is 13 cards at full spacing (489 px natural)", () => {
    expect(TABLEAU_MAX_HEIGHT).toBe(489);
  });

  it("a 6-card column keeps the full 36 px offset (height 237)", () => {
    const off = computeCardOffset(6);
    expect(off).toBe(36);
    expect(CARD_HEIGHT + 5 * off).toBe(237);
  });

  it("13 cards still use full spacing and fit exactly", () => {
    const off = computeCardOffset(13);
    expect(off).toBe(36);
    expect(CARD_HEIGHT + 12 * off).toBe(489);
  });

  it("14 cards compress (~33.2 px) and fit", () => {
    const off = computeCardOffset(14);
    expect(off).toBeLessThan(36);
    expect(off).toBeCloseTo(33.23, 1);
    expect(CARD_HEIGHT + 13 * off).toBeLessThanOrEqual(489 + 1e-9);
  });

  it("37+ cards clamp to the 12 px minimum", () => {
    expect(computeCardOffset(37)).toBe(12);
    expect(computeCardOffset(52)).toBe(MIN_FACE_UP_OFFSET);
  });

  it("is a pure function of length: a shrinking column regains full spacing", () => {
    expect(computeCardOffset(20)).toBeCloseTo(22.74, 1);
    expect(computeCardOffset(10)).toBe(36);
  });

  it("a single card (or empty column) uses the full offset", () => {
    expect(computeCardOffset(1)).toBe(FACE_UP_OFFSET);
    expect(computeCardOffset(0)).toBe(FACE_UP_OFFSET);
  });

  it("uses the measured height when given (SE-class screen)", () => {
    // 35 px cards (scale 0.875) on a short screen: 300 px for the tableau.
    const scale = 35 / CARD_WIDTH;
    const cardH = Math.round(CARD_HEIGHT * scale);
    const off = computeCardOffset(19, Math.round(36 * scale), cardH, 300, 12 * scale);
    expect(cardH + 18 * off).toBeLessThanOrEqual(300 + 1e-9);
  });
});

describe("TableauColumn layout (#1108)", () => {
  function renderColumn(n: number, maxHeight?: number, cardWidth = CARD_WIDTH) {
    const cardHeight = Math.round((CARD_HEIGHT * cardWidth) / CARD_WIDTH);
    return render(
      <ThemeProvider>
        <CardSizeContext.Provider value={{ cardWidth, cardHeight }}>
          <DragProvider>
            <TableauColumn pile={pileOf(n)} colIndex={2} maxHeight={maxHeight} />
          </DragProvider>
        </CardSizeContext.Provider>
      </ThemeProvider>
    );
  }

  function topOf(el: { props: { style: unknown } }): number {
    return (StyleSheet.flatten(el.props.style as never) as { top: number }).top;
  }

  it("keeps full spacing for a short column", async () => {
    const { getByTestId } = await renderColumn(6);
    expect(topOf(getByTestId("freecell-col-2-top"))).toBe(5 * 36);
  });

  it("keeps the last card inside the height it was given", async () => {
    const maxHeight = 360;
    const { getByTestId } = await renderColumn(19, maxHeight);
    const lastTop = topOf(getByTestId("freecell-col-2-top"));
    expect(lastTop + CARD_HEIGHT).toBeLessThanOrEqual(maxHeight + 1e-9);
    // Evenly spaced: the second card sits one offset down.
    expect(topOf(getByTestId("freecell-col-2-card-1"))).toBeCloseTo(lastTop / 18, 5);
  });

  it("scales the default budget with the card size when nothing is measured", async () => {
    const width = 35;
    const scale = width / CARD_WIDTH;
    const cardH = Math.round(CARD_HEIGHT * scale);
    const { getByTestId } = await renderColumn(16, undefined, width);
    const lastTop = topOf(getByTestId("freecell-col-2-top"));
    expect(lastTop + cardH).toBeLessThanOrEqual(TABLEAU_MAX_HEIGHT * scale + 1e-9);
  });

  it("every card in a compressed column stays labelled for screen readers", async () => {
    const { getByLabelText } = await renderColumn(19, 360);
    expect(getByLabelText(/^A of Spades/)).toBeTruthy();
  });
});
