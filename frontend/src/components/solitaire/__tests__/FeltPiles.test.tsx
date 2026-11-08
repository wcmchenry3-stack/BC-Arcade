/**
 * The Solitaire piles on the felt (#3606): the faint "K" on an empty column, the
 * green outline and the "can move here" hint on a legal destination, the face-up
 * step the board hands a column, and the stock as a card back.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";

import { ThemeProvider, dark } from "../../../theme/ThemeContext";
import { CardSizeContext } from "../../../game/_shared/CardSizeContext";
import { DragProvider } from "../../../game/_shared/drag/DragContext";
import { TABLE_SLOT_EDGE, TABLE_SLOT_MARK } from "../../../theme/theme.table";
import FoundationPile from "../FoundationPile";
import StockWastePile from "../StockWastePile";
import TableauPile from "../TableauPile";
import type { Card } from "../../../game/solitaire/types";

const SIZE = { cardWidth: 47, cardHeight: 67 };
const withTheme = (ui: React.ReactElement) => (
  <DragProvider>
    <ThemeProvider>
      <CardSizeContext.Provider value={SIZE}>{ui}</CardSizeContext.Provider>
    </ThemeProvider>
  </DragProvider>
);
const up = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank, faceUp: true });
const down = (suit: Card["suit"], rank: Card["rank"]): Card => ({ suit, rank, faceUp: false });

describe("TableauPile on the felt", () => {
  it("an empty column is a faint outline with a K", async () => {
    const { getByLabelText, getByTestId } = await render(
      withTheme(<TableauPile pile={[]} colIndex={2} dropId="solitaire-tableau-2" />)
    );
    expect(StyleSheet.flatten(getByLabelText("Empty tableau column 3").props.style)).toMatchObject({
      borderColor: TABLE_SLOT_EDGE,
    });
    const marker = getByTestId("solitaire-tableau-2-marker", { hidden: true });
    expect(marker.props.children).toBe("K");
    expect(StyleSheet.flatten(marker.props.style).color).toBe(TABLE_SLOT_MARK);
  });

  it("a legal empty column is outlined in the bonus token and hinted", async () => {
    const { getByLabelText } = await render(
      withTheme(<TableauPile pile={[]} colIndex={0} legalTarget />)
    );
    const column = getByLabelText("Empty tableau column 1");
    expect(StyleSheet.flatten(column.props.style)).toMatchObject({
      borderColor: dark.bonus,
      borderWidth: 3,
    });
    expect(column.props.accessibilityHint).toBe("Can move here");
  });

  it("a legal column outlines its top card and hints, without changing its label", async () => {
    const pile = [down("clubs", 9), up("hearts", 7)];
    const { getByLabelText, getByTestId, getAllByHintText } = await render(
      withTheme(<TableauPile pile={pile} colIndex={1} dropId="solitaire-tableau-1" legalTarget />)
    );
    const outline = StyleSheet.flatten(getByTestId("solitaire-tableau-1-target").props.style);
    expect(outline).toMatchObject({
      borderColor: dark.bonus,
      borderWidth: 3,
      width: 47,
      height: 67,
    });
    // The hint is on the top card (what a screen reader lands on), once.
    expect(getByLabelText("7 of Hearts").props.accessibilityHint).toBe("Can move here");
    expect(getByLabelText("Face-down card").props.accessibilityHint).toBeUndefined();
    expect(getByLabelText("Tableau column 2, 2 cards").props.accessibilityHint).toBeUndefined();
    expect(getAllByHintText("Can move here")).toHaveLength(1);
  });

  it("a column that is not a target has no outline and no hint", async () => {
    const { getByLabelText, queryByTestId } = await render(
      withTheme(<TableauPile pile={[up("hearts", 7)]} colIndex={1} dropId="solitaire-tableau-1" />)
    );
    expect(queryByTestId("solitaire-tableau-1-target")).toBeNull();
    expect(getByLabelText("Tableau column 2, 1 cards").props.accessibilityHint).toBeUndefined();
    expect(getByLabelText("7 of Hearts").props.accessibilityHint).toBeUndefined();
  });

  it("uses the face-up and face-down steps the board hands it", async () => {
    const pile = [down("clubs", 9), up("hearts", 7), up("spades", 6)];
    const { getByTestId } = await render(
      withTheme(<TableauPile pile={pile} colIndex={0} faceUpOffset={48} faceDownOffset={13} />)
    );
    const top = (i: number) =>
      (
        StyleSheet.flatten(getByTestId(`solitaire-tableau-0-card-${i}`).props.style) as {
          top: number;
        }
      ).top;
    expect(top(1)).toBe(13);
    expect(top(2)).toBe(13 + 48);
  });
});

describe("FoundationPile on the felt", () => {
  it("an empty foundation is a faint outline", async () => {
    const { getByLabelText } = await render(
      withTheme(<FoundationPile pile={[]} suit="hearts" onPress={jest.fn()} />)
    );
    expect(StyleSheet.flatten(getByLabelText("Empty Hearts foundation").props.style)).toMatchObject(
      { borderColor: TABLE_SLOT_EDGE }
    );
  });

  it("a legal empty foundation is outlined in the bonus token and hinted", async () => {
    const { getByLabelText, getByTestId } = await render(
      withTheme(<FoundationPile pile={[]} suit="spades" legalTarget onPress={jest.fn()} />)
    );
    const empty = getByLabelText("Empty Spades foundation");
    expect(StyleSheet.flatten(empty.props.style)).toMatchObject({ borderColor: dark.bonus });
    expect(empty.props.accessibilityHint).toBe("Can move here");
    expect(getByTestId("solitaire-foundation-spades-target")).toBeTruthy();
  });

  it("a legal foundation with cards outlines its top card; the outline is not announced", async () => {
    const { getByTestId } = await render(
      withTheme(
        <FoundationPile pile={[up("spades", 1)]} suit="spades" legalTarget onPress={jest.fn()} />
      )
    );
    const outline = getByTestId("solitaire-foundation-spades-target", { hidden: true });
    expect(StyleSheet.flatten(outline.props.style)).toMatchObject({
      borderColor: dark.bonus,
      borderWidth: 3,
    });
    // Not a screen-reader stop of its own; the top card's DraggableCard carries the hint
    // (TargetHint.test.tsx).
    expect(outline.props.accessible).toBe(false);
    expect(outline.props.accessibilityHint).toBeUndefined();
  });

  it("a foundation that is not a target has no outline", async () => {
    const { queryByTestId } = await render(
      withTheme(<FoundationPile pile={[up("spades", 1)]} suit="spades" onPress={jest.fn()} />)
    );
    expect(queryByTestId("solitaire-foundation-spades-target")).toBeNull();
  });
});

describe("StockWastePile on the felt", () => {
  it("a stock with cards is a card back with its count", async () => {
    const stock = [down("clubs", 9), down("clubs", 8)];
    const { getByText, getByTestId } = await render(
      withTheme(<StockWastePile stock={stock} waste={[]} drawMode={1} onStockPress={jest.fn()} />)
    );
    expect(getByText("2")).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId("solitaire-stock-pile").props.style)).toMatchObject({
      width: 47,
      height: 67,
    });
  });

  it("an empty stock is a faint outline with the recycle mark", async () => {
    const { getByText, getByTestId } = await render(
      withTheme(<StockWastePile stock={[]} waste={[]} drawMode={1} onStockPress={jest.fn()} />)
    );
    expect(getByText("↻")).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId("solitaire-stock-pile").props.style)).toMatchObject({
      borderColor: TABLE_SLOT_EDGE,
    });
  });
});
