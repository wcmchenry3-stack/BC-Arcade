/**
 * FreeCell's tableau column on the felt (#3607). It used to compress itself to a
 * height it was given (#1108, `computeCardOffset`); the board now picks one step
 * for every column from the felt's geometry (`faceUpStepFor`, tested in
 * `_shared/cards/__tests__/tableLayout.test.ts` and `FreeCellScreen.feltTable.test.tsx`),
 * and the column draws the step it is given.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";

import { ThemeProvider } from "../../../theme/ThemeContext";
import { CardSizeContext } from "../../../game/_shared/CardSizeContext";
import { DragProvider } from "../../../game/_shared/drag/DragContext";
import TableauColumn from "../TableauColumn";
import { CARD_HEIGHT, CARD_WIDTH } from "../FreeCellSlot";
import type { Card } from "../../../game/freecell/types";

const SUITS = ["spades", "hearts", "clubs", "diamonds"] as const;
function pileOf(n: number): Card[] {
  return Array.from({ length: n }, (_, i) => ({
    suit: SUITS[i % 4]!,
    rank: ((i % 13) + 1) as Card["rank"],
  }));
}

function renderColumn(props: Partial<React.ComponentProps<typeof TableauColumn>> & { n: number }) {
  const { n, ...rest } = props;
  return render(
    <ThemeProvider>
      <CardSizeContext.Provider value={{ cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT }}>
        <DragProvider>
          <TableauColumn pile={pileOf(n)} colIndex={2} {...rest} />
        </DragProvider>
      </CardSizeContext.Provider>
    </ThemeProvider>
  );
}

function topOf(el: { props: { style: unknown } }): number {
  return (StyleSheet.flatten(el.props.style as never) as { top: number }).top;
}

describe("FreeCell TableauColumn on the felt (#3607)", () => {
  it("stacks the cards by the step the board gives it", async () => {
    const { getByTestId } = await renderColumn({ n: 19, faceUpOffset: 22 });
    expect(topOf(getByTestId("freecell-col-2-card-1"))).toBe(22);
    expect(topOf(getByTestId("freecell-col-2-top"))).toBe(18 * 22);
  });

  it("without a step, uses the natural 36 dp on the natural card", async () => {
    const { getByTestId } = await renderColumn({ n: 6 });
    expect(topOf(getByTestId("freecell-col-2-top"))).toBe(5 * 36);
  });

  it("every card in a tight column stays labelled for screen readers", async () => {
    const { getByLabelText } = await renderColumn({ n: 19, faceUpOffset: 15 });
    expect(getByLabelText(/^A of Spades/)).toBeTruthy();
  });

  it("a legal target: one 'Can move here' hint, on the top card, and an unannounced outline", async () => {
    const { getAllByHintText, getByTestId } = await renderColumn({
      n: 3,
      legalTarget: true,
      dropId: "freecell-tableau-2",
      onDrop: () => true,
    });
    const hinted = getAllByHintText("Can move here");
    expect(hinted).toHaveLength(1);
    expect(hinted[0]!.props.accessibilityLabel).toBe("3 of Clubs");
    const outline = getByTestId("freecell-tableau-2-target");
    expect(outline.props.accessible).toBe(false);
    expect(outline.props.pointerEvents).toBe("none");
  });

  it("an empty legal target carries the hint on the slot itself", async () => {
    const { getAllByHintText } = await renderColumn({
      n: 0,
      legalTarget: true,
      dropId: "freecell-tableau-2",
      onDrop: () => true,
    });
    const hinted = getAllByHintText("Can move here");
    expect(hinted).toHaveLength(1);
    expect(hinted[0]!.props.accessibilityLabel).toBe("Empty tableau column 3");
  });

  it("no hint and no outline when it is not a legal target", async () => {
    const { queryAllByHintText, queryByTestId } = await renderColumn({
      n: 3,
      dropId: "freecell-tableau-2",
      onDrop: () => true,
    });
    expect(queryAllByHintText("Can move here")).toHaveLength(0);
    expect(queryByTestId("freecell-tableau-2-target")).toBeNull();
  });
});
