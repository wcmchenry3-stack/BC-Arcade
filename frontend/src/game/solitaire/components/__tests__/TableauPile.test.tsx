import React from "react";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import type { Card, Rank, Suit } from "../../types";
import TableauPile from "../TableauPile";
import { DragProvider } from "../../../_shared/drag/DragContext";
import { DraggableCard } from "../../../_shared/drag/DraggableCard";

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
  it("renders a dashed placeholder when the column is empty", () => {
    const { getByLabelText } = render(withTheme(<TableauPile pile={[]} colIndex={0} />));
    expect(getByLabelText(/Empty tableau column 1/)).toBeTruthy();
  });

  it("fires onEmptyPress when the empty placeholder is tapped", () => {
    const onEmptyPress = jest.fn();
    const { getByLabelText } = render(
      withTheme(<TableauPile pile={[]} colIndex={2} onEmptyPress={onEmptyPress} />)
    );
    fireEvent.press(getByLabelText(/Empty tableau column 3/));
    expect(onEmptyPress).toHaveBeenCalledWith(2);
  });

  it("renders every card in the pile and exposes the pile-size label", () => {
    const pile = [card("spades", 5, false), card("hearts", 6), card("clubs", 5)];
    const { getByText, getByLabelText } = render(
      withTheme(<TableauPile pile={pile} colIndex={1} />)
    );
    // Face-up cards contribute their rank text; the face-down one does not.
    expect(getByText("6")).toBeTruthy();
    expect(getByText("5")).toBeTruthy(); // clubs 5 (top)
    expect(getByLabelText(/Tableau column 2, 3 cards/)).toBeTruthy();
  });

  it("fires onCardPress with (colIndex, cardIndex) when a card is tapped", () => {
    const onCardPress = jest.fn();
    const pile = [card("spades", 1), card("hearts", 2)];
    const { getAllByRole } = render(
      withTheme(<TableauPile pile={pile} colIndex={4} onCardPress={onCardPress} />)
    );
    const buttons = getAllByRole("button");
    fireEvent.press(buttons[1]!); // second card (index 1)
    expect(onCardPress).toHaveBeenCalledWith(4, 1);
  });

  it("highlights the selected card and every card stacked on top of it", () => {
    const pile = [card("spades", 5), card("hearts", 4), card("clubs", 3)];
    const { getAllByLabelText } = render(
      withTheme(<TableauPile pile={pile} colIndex={0} selectedIndex={1} />)
    );
    // Index 0 not selected; indices 1 and 2 are.
    const selectedLabels = getAllByLabelText(/\(selected\)/);
    expect(selectedLabels).toHaveLength(2);
  });
});

describe("TableauPile — cascade offsets (#1247)", () => {
  it("12-card column height snapshot (6 face-down + 6 face-up, natural card size)", () => {
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
    const { getByLabelText } = render(withTheme(<TableauPile pile={pile} colIndex={0} />));
    const container = getByLabelText("Tableau column 1, 12 cards");
    expect(container.props.style).toMatchSnapshot();
  });
});

describe("TableauPile — hitSlop on buried cards (#1248)", () => {
  it("buried DraggableCard wrappers receive hitSlop; top card does not", () => {
    const pile = [card("spades", 5, false), card("hearts", 6), card("clubs", 5)];
    const { UNSAFE_getAllByType } = render(withTheme(<TableauPile pile={pile} colIndex={0} />));
    const draggables = UNSAFE_getAllByType(DraggableCard);
    expect(draggables).toHaveLength(3);
    // Cards at index 0 and 1 are buried — must have hitSlop.
    expect(draggables[0]!.props.hitSlop).toBeDefined();
    expect(draggables[1]!.props.hitSlop).toBeDefined();
    // Top card (index 2) must NOT have hitSlop.
    expect(draggables[2]!.props.hitSlop).toBeUndefined();
  });

  it("hitSlop bottom is clamped to the visible strip height (face-down strip < 24pt)", () => {
    // face-down strip = FACE_DOWN_OFFSET (20) < 24, so bottom = 20.
    const pile = [card("spades", 5, false), card("hearts", 6)];
    const { UNSAFE_getAllByType } = render(withTheme(<TableauPile pile={pile} colIndex={0} />));
    const draggables = UNSAFE_getAllByType(DraggableCard);
    const buriedSlop = draggables[0]!.props.hitSlop;
    expect(buriedSlop).toBeDefined();
    expect(buriedSlop.top).toBe(0);
    expect(buriedSlop.left).toBe(4);
    expect(buriedSlop.right).toBe(4);
    // Bottom clamped to face-down offset (20), which is < 24.
    expect(buriedSlop.bottom).toBeLessThanOrEqual(24);
    expect(buriedSlop.bottom).toBeGreaterThan(0);
  });
});
