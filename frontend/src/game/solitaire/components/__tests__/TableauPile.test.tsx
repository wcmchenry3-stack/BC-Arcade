import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import type { Card, Rank, Suit } from "../../types";
import TableauPile from "../TableauPile";
import { DragProvider } from "../../../_shared/drag/DragContext";

function withTheme(children: React.ReactNode) {
  return (
    <DragProvider>
      <ThemeProvider>{children}</ThemeProvider>
    </DragProvider>
  );
}

function card(suit: Suit, rank: Rank, faceUp = true): Card {
  return { suit, rank, faceUp };
}

describe("TableauPile", () => {
  it("renders a dashed placeholder when the column is empty", async () => {
    const { getByLabelText } = await render(withTheme(<TableauPile pile={[]} colIndex={0} />));
    expect(getByLabelText(/Empty tableau column 1/)).toBeTruthy();
  });

  it("fires onEmptyPress when the empty placeholder is tapped", async () => {
    const onEmptyPress = jest.fn();
    const { getByLabelText } = await render(
      withTheme(<TableauPile pile={[]} colIndex={2} onEmptyPress={onEmptyPress} />)
    );
    await fireEvent.press(getByLabelText(/Empty tableau column 3/));
    expect(onEmptyPress).toHaveBeenCalledWith(2);
  });

  it("renders every card in the pile and exposes the pile-size label", async () => {
    const pile = [card("spades", 5, false), card("hearts", 6), card("clubs", 5)];
    const { getByText, getByLabelText } = await render(
      withTheme(<TableauPile pile={pile} colIndex={1} />)
    );
    // Face-up cards contribute their rank text; the face-down one does not.
    expect(getByText("6")).toBeTruthy();
    expect(getByText("5")).toBeTruthy(); // clubs 5 (top)
    expect(getByLabelText(/Tableau column 2, 3 cards/)).toBeTruthy();
  });

  it("fires onCardPress with (colIndex, cardIndex) when a card is tapped", async () => {
    const onCardPress = jest.fn();
    const pile = [card("spades", 1), card("hearts", 2)];
    const { getAllByRole } = await render(
      withTheme(<TableauPile pile={pile} colIndex={4} onCardPress={onCardPress} />)
    );
    const buttons = getAllByRole("button");
    await fireEvent.press(buttons[1]!); // second card (index 1)
    expect(onCardPress).toHaveBeenCalledWith(4, 1);
  });

  it("highlights the selected card and every card stacked on top of it", async () => {
    const pile = [card("spades", 5), card("hearts", 4), card("clubs", 3)];
    const { getAllByLabelText } = await render(
      withTheme(<TableauPile pile={pile} colIndex={0} selectedIndex={1} />)
    );
    // Index 0 not selected; indices 1 and 2 are.
    const selectedLabels = getAllByLabelText(/\(selected\)/);
    expect(selectedLabels).toHaveLength(2);
  });
});

describe("TableauPile — cascade offsets (#1247)", () => {
  it("12-card column height snapshot (6 face-down + 6 face-up, natural card size)", async () => {
    const pile: Card[] = [
      card("spades", 13, false),
      card("spades", 12, false),
      card("spades", 11, false),
      card("spades", 10, false),
      card("spades", 9, false),
      card("spades", 8, false),
      card("hearts", 7),
      card("hearts", 6),
      card("diamonds", 5),
      card("clubs", 4),
      card("hearts", 3),
      card("spades", 2),
    ];
    const { getByLabelText } = await render(withTheme(<TableauPile pile={pile} colIndex={0} />));
    const container = getByLabelText("Tableau column 1, 12 cards");
    expect(container.props.style).toMatchSnapshot();
  });
});

describe("TableauPile — hitSlop on buried cards (#1248)", () => {
  // hitSlop is passed as a prop to DraggableCard and applied to the Gesture objects.
  // RNTL v14's TestInstance tree only exposes host elements, not component props,
  // so gesture-level hitSlop cannot be asserted in Jest — device/Maestro E2E covers it.
  // These tests verify the pile renders correctly and the testIDs are in place.

  it("renders buried and top-card elements with expected testIDs", async () => {
    const pile = [card("spades", 5, false), card("hearts", 6), card("clubs", 5)];
    const { getByTestId } = await render(withTheme(<TableauPile pile={pile} colIndex={0} />));
    expect(getByTestId("solitaire-tableau-0-card-0")).toBeTruthy();
    expect(getByTestId("solitaire-tableau-0-card-1")).toBeTruthy();
    expect(getByTestId("solitaire-tableau-0-card-2")).toBeTruthy();
  });

  it("renders a 2-card pile with a face-down buried card without throwing", async () => {
    // face-down strip = FACE_DOWN_OFFSET (20) → hitSlop bottom clamped to 20.
    const pile = [card("spades", 5, false), card("hearts", 6)];
    const { getByTestId } = await render(withTheme(<TableauPile pile={pile} colIndex={0} />));
    expect(getByTestId("solitaire-tableau-0-card-0")).toBeTruthy();
    expect(getByTestId("solitaire-tableau-0-card-1")).toBeTruthy();
  });
});
