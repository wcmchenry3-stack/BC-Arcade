import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../../theme/ThemeContext";
import { CardDeckProvider } from "../CardDeckContext";
import PlayingCard from "../../../../components/shared/PlayingCard";

// In Jest, AsyncStorage returns null → CardDeckContext stays on MinimalDeck.
// These tests exercise the full stack: PlayingCard → CardDeckContext → MinimalCardFace.

async function wrap(ui: React.ReactElement) {
  return await render(
    <ThemeProvider>
      <CardDeckProvider>{ui}</CardDeckProvider>
    </ThemeProvider>
  );
}

describe("PlayingCard + MinimalDeck (Jest default)", () => {
  it("renders rank and suit text when face-up", async () => {
    await wrap(<PlayingCard suit="spades" rank={1} accessibilityLabel="A of Spades" />);
    expect(screen.getByText("A")).toBeTruthy();
    expect(screen.getByText("♠")).toBeTruthy();
  });

  it("renders 10 correctly (not T)", async () => {
    await wrap(<PlayingCard suit="hearts" rank={10} />);
    expect(screen.getByText("10")).toBeTruthy();
  });

  it("renders J, Q, K face card labels", async () => {
    const { getByText: getJ } = await wrap(<PlayingCard suit="clubs" rank={11} />);
    expect(getJ("J")).toBeTruthy();
    const { getByText: getQ } = await wrap(<PlayingCard suit="diamonds" rank={12} />);
    expect(getQ("Q")).toBeTruthy();
    const { getByText: getK } = await wrap(<PlayingCard suit="hearts" rank={13} />);
    expect(getK("K")).toBeTruthy();
  });

  it("shows ? and hides rank/suit when face-down", async () => {
    await wrap(<PlayingCard suit="spades" rank={1} faceDown accessibilityLabel="Face-down card" />);
    expect(screen.getByText("?")).toBeTruthy();
    expect(screen.queryByText("A")).toBeNull();
    expect(screen.queryByText("♠")).toBeNull();
  });

  it("uses accessibilityLabel on the wrapper", async () => {
    await wrap(<PlayingCard suit="hearts" rank={1} accessibilityLabel="A of Hearts" />);
    expect(screen.getByLabelText("A of Hearts")).toBeTruthy();
  });

  it("renders button role and fires onPress", async () => {
    const onPress = jest.fn();
    await wrap(
      <PlayingCard suit="clubs" rank={7} onPress={onPress} accessibilityLabel="7 of Clubs" />
    );
    await fireEvent.press(screen.getByRole("button"));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it("does not fire onPress when disabled", async () => {
    const onPress = jest.fn();
    await wrap(
      <PlayingCard
        suit="clubs"
        rank={7}
        onPress={onPress}
        disabled
        accessibilityLabel="7 of Clubs"
      />
    );
    await fireEvent.press(screen.getByRole("button"));
    expect(onPress).not.toHaveBeenCalled();
  });

  it("renders image role (not button) when no onPress", async () => {
    await wrap(<PlayingCard suit="diamonds" rank={5} accessibilityLabel="5 of Diamonds" />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
