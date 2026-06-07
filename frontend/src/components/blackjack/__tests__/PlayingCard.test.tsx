import React from "react";
import { render } from "@testing-library/react-native";
import PlayingCard from "../PlayingCard";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function renderCard(props: Parameters<typeof PlayingCard>[0]) {
  return await render(
    <ThemeProvider>
      <PlayingCard {...props} />
    </ThemeProvider>
  );
}

describe("PlayingCard", () => {
  it("renders rank and suit for a visible card", async () => {
    const { getByText } = await renderCard({ card: { rank: "A", suit: "♠", face_down: false } });
    expect(getByText("A")).toBeTruthy();
    expect(getByText("♠")).toBeTruthy();
  });

  it("renders face-down placeholder when face_down is true", async () => {
    const { getByText, queryByText } = await renderCard({
      card: { rank: "K", suit: "♥", face_down: true },
    });
    expect(getByText("?")).toBeTruthy();
    expect(queryByText("K")).toBeNull();
  });

  it("has correct accessibilityLabel for a visible spades card", async () => {
    const { getByLabelText } = await renderCard({
      card: { rank: "K", suit: "♠", face_down: false },
    });
    expect(getByLabelText(/K.*Spades|Spades.*K/i)).toBeTruthy();
  });

  it("has correct accessibilityLabel for a face-down card", async () => {
    const { getByLabelText } = await renderCard({
      card: { rank: "?", suit: "?", face_down: true },
    });
    expect(getByLabelText(/face.down/i)).toBeTruthy();
  });
});
