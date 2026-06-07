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
  it("renders rank and suit for a face-up spade ace", async () => {
    const { getByText } = await render(withTheme(<CardView card={c()} />));
    expect(getByText("A")).toBeTruthy();
    expect(getByText("♠")).toBeTruthy();
  });

  it("renders J/Q/K labels for royals", async () => {
    const { getByText: getJ } = await render(withTheme(<CardView card={c({ rank: 11 })} />));
    expect(getJ("J")).toBeTruthy();
    const { getByText: getQ } = await render(withTheme(<CardView card={c({ rank: 12 })} />));
    expect(getQ("Q")).toBeTruthy();
    const { getByText: getK } = await render(withTheme(<CardView card={c({ rank: 13 })} />));
    expect(getK("K")).toBeTruthy();
  });

  it("renders numeric labels for 2-10", async () => {
    const { getByText } = await render(withTheme(<CardView card={c({ rank: 7 })} />));
    expect(getByText("7")).toBeTruthy();
  });

  it("renders no rank/suit text when face-down", async () => {
    const { queryByText } = await render(
      withTheme(<CardView card={c({ faceUp: false, rank: 5 })} />)
    );
    expect(queryByText("5")).toBeNull();
    expect(queryByText("♠")).toBeNull();
  });

  it("has an accessibility label describing the face-up card", async () => {
    const { getByLabelText } = await render(
      withTheme(<CardView card={c({ rank: 13, suit: "hearts" })} />)
    );
    expect(getByLabelText(/K of Hearts/)).toBeTruthy();
  });

  it("labels a face-down card as such", async () => {
    const { getByLabelText } = await render(withTheme(<CardView card={c({ faceUp: false })} />));
    expect(getByLabelText(/face-down/i)).toBeTruthy();
  });

  it("annotates 'selected' in the label when selected", async () => {
    const { getByLabelText } = await render(withTheme(<CardView card={c()} selected />));
    expect(getByLabelText(/\(selected\)/)).toBeTruthy();
  });

  it("fires onPress when tapped", async () => {
    const onPress = jest.fn();
    const { getByRole } = await render(withTheme(<CardView card={c()} onPress={onPress} />));
    await fireEvent.press(getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not register a button role when no onPress is provided", async () => {
    const { queryByRole } = await render(withTheme(<CardView card={c()} />));
    expect(queryByRole("button")).toBeNull();
  });
});

describe("CardView — natural size without Provider", () => {
  it("renders at natural CARD_WIDTH × CARD_HEIGHT when no CardSizeContext.Provider ancestor exists", async () => {
    // CardSizeContext defaults to { cardWidth: CARD_WIDTH, cardHeight: CARD_HEIGHT }
    // so components outside a Provider should render at the natural card size, not 0×0.
    const { getByLabelText } = await render(
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
