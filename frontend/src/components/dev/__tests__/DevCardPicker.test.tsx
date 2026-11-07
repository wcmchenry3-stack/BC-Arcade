/** DevCardPicker (#3576): the game-agnostic card picker for dev panels. */
import React, { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { DevCardPicker, type DevPickerCard } from "../DevCardPicker";

const onChangeSpy = jest.fn();

const PAIR = [
  { rank: "8", suit: "♠" },
  { rank: "8", suit: "♥" },
];

function Harness({ initial = [] as DevPickerCard[] }) {
  const [cards, setCards] = useState<readonly DevPickerCard[]>(initial);
  return (
    <ThemeProvider>
      <DevCardPicker
        cards={cards}
        onChange={(next) => {
          onChangeSpy(next);
          setCards(next);
        }}
        presets={[{ label: "Pair", cards: PAIR }]}
      />
    </ThemeProvider>
  );
}

beforeEach(() => jest.clearAllMocks());

describe("DevCardPicker", () => {
  it("adds a card by rank then suit, in order", async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("dev-card-rank-10"));
    await fireEvent.press(screen.getByTestId("dev-card-suit-♦"));
    await fireEvent.press(screen.getByTestId("dev-card-rank-A"));
    await fireEvent.press(screen.getByTestId("dev-card-suit-♠"));
    expect(screen.getByText("1. 10♦")).toBeTruthy();
    expect(screen.getByText("2. A♠")).toBeTruthy();
  });

  it("ignores a suit press before a rank is chosen", async () => {
    await render(<Harness />);
    await fireEvent.press(screen.getByTestId("dev-card-suit-♠"));
    expect(onChangeSpy).not.toHaveBeenCalled();
    expect(screen.getByText("No cards picked")).toBeTruthy();
  });

  it("removes a card", async () => {
    await render(
      <Harness
        initial={[
          { rank: "2", suit: "♠" },
          { rank: "3", suit: "♥" },
        ]}
      />
    );
    await fireEvent.press(screen.getByTestId("dev-card-remove-0"));
    expect(screen.queryByText("1. 2♠")).toBeNull();
    expect(screen.getByText("1. 3♥")).toBeTruthy();
  });

  it("moves cards up and down, and ignores moves past the ends", async () => {
    await render(
      <Harness
        initial={[
          { rank: "2", suit: "♠" },
          { rank: "3", suit: "♥" },
        ]}
      />
    );
    await fireEvent.press(screen.getByTestId("dev-card-down-0"));
    expect(screen.getByText("1. 3♥")).toBeTruthy();
    expect(screen.getByText("2. 2♠")).toBeTruthy();
    await fireEvent.press(screen.getByTestId("dev-card-up-0"));
    expect(onChangeSpy).toHaveBeenCalledTimes(1); // first card up is a no-op
    await fireEvent.press(screen.getByTestId("dev-card-up-1"));
    expect(screen.getByText("1. 2♠")).toBeTruthy();
  });

  it("fills the list from a preset and clears it", async () => {
    await render(<Harness initial={[{ rank: "K", suit: "♣" }]} />);
    await fireEvent.press(screen.getByTestId("dev-card-preset-Pair"));
    expect(screen.getByText("1. 8♠")).toBeTruthy();
    expect(screen.getByText("2. 8♥")).toBeTruthy();
    expect(screen.queryByText("1. K♣")).toBeNull();
    await fireEvent.press(screen.getByTestId("dev-card-clear"));
    expect(screen.getByText("No cards picked")).toBeTruthy();
  });
});
