import React from "react";
import { StyleSheet } from "react-native";
import { render, fireEvent } from "@testing-library/react-native";

import { ThemeProvider } from "../../../../theme/ThemeContext";
import type { Card } from "../../types";
import CardView, { CARD_WIDTH, CARD_HEIGHT } from "../CardView";

function withTheme(children: React.ReactNode) {
  return <ThemeProvider>{children}</ThemeProvider>;
}

function c(overrides: Partial<Card> = {}): Card {
  return { suit: "spades", rank: 1, faceUp: true, ...overrides };
}

describe("CardView", () => {
  it("renders rank and suit for a face-up spade ace", () => {
    const { getByText } = render(withTheme(<CardView card={c()} />));
    expect(getByText("A")).toBeTruthy();
    expect(getByText("♠")).toBeTruthy();
  });

  it("renders J/Q/K labels for royals", () => {
    const { getByText: getJ } = render(withTheme(<CardView card={c({ rank: 11 })} />));
    expect(getJ("J")).toBeTruthy();
    const { getByText: getQ } = render(withTheme(<CardView card={c({ rank: 12 })} />));
    expect(getQ("Q")).toBeTruthy();
    const { getByText: getK } = render(withTheme(<CardView card={c({ rank: 13 })} />));
    expect(getK("K")).toBeTruthy();
  });

  it("renders numeric labels for 2-10", () => {
    const { getByText } = render(withTheme(<CardView card={c({ rank: 7 })} />));
    expect(getByText("7")).toBeTruthy();
  });

  it("renders no rank/suit text when face-down", () => {
    const { queryByText } = render(withTheme(<CardView card={c({ faceUp: false, rank: 5 })} />));
    expect(queryByText("5")).toBeNull();
    expect(queryByText("♠")).toBeNull();
  });

  it("has an accessibility label describing the face-up card", () => {
    const { getByLabelText } = render(
      withTheme(<CardView card={c({ rank: 13, suit: "hearts" })} />)
    );
    expect(getByLabelText(/K of Hearts/)).toBeTruthy();
  });

  it("labels a face-down card as such", () => {
    const { getByLabelText } = render(withTheme(<CardView card={c({ faceUp: false })} />));
    expect(getByLabelText(/face-down/i)).toBeTruthy();
  });

  it("annotates 'selected' in the label when selected", () => {
    const { getByLabelText } = render(withTheme(<CardView card={c()} selected />));
    expect(getByLabelText(/\(selected\)/)).toBeTruthy();
  });

  it("fires onPress when tapped", () => {
    const onPress = jest.fn();
    const { getByRole } = render(withTheme(<CardView card={c()} onPress={onPress} />));
    fireEvent.press(getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not register a button role when no onPress is provided", () => {
    const { queryByRole } = render(withTheme(<CardView card={c()} />));
    expect(queryByRole("button")).toBeNull();
  });
});

describe("CardView — natural size without Provider", () => {
  it("renders at natural CARD_WIDTH × CARD_HEIGHT when no CardSizeContext.Provider ancestor exists", () => {
    // CardSizeContext defaults to { cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT }
    // so components outside a Provider should render at the natural card size, not 0×0.
    const { getByLabelText } = render(
      <ThemeProvider>
        <CardView card={c({ rank: 7, suit: "diamonds" })} />
      </ThemeProvider>
    );
    const el = getByLabelText(/7 of Diamonds/);
    const flat = StyleSheet.flatten(el.props.style);
    expect(flat.width).toBe(CARD_WIDTH);
    expect(flat.height).toBe(CARD_HEIGHT);
  });
});
