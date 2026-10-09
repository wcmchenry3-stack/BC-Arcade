/**
 * #2983: the playing-card colour tokens. They replace literals PlayingCard and Hearts'
 * CapturedPile used to hard-code, so their values are pinned to those literals in both themes
 * (#2989 may later give light mode its own), and PlayingCard must hand them to the deck.
 */
import React from "react";
import { render } from "@testing-library/react-native";

import { ThemeProvider, dark, light } from "../ThemeContext";
import PlayingCard from "../../components/shared/PlayingCard";
import type { CardFaceProps } from "../../game/_shared/decks/types";

const mockFaceProps: CardFaceProps[] = [];
jest.mock("../../game/_shared/decks/CardDeckContext", () => ({
  useDeck: () => ({
    activeDeck: {
      id: "probe",
      name: "Probe",
      CardFace: (props: CardFaceProps) => {
        mockFaceProps.push(props);
        return null;
      },
    },
  }),
}));

describe("card colour tokens", () => {
  it.each([
    ["dark", dark],
    ["light", light],
  ])("%s: the face, ink and red-suit colours cards rendered before #2983", (_name, colors) => {
    expect(colors.cardFace).toBe("#fff");
    expect(colors.cardInk).toBe("#0e0e13");
    expect(colors.cardRedSuit).toBe("#ff716c");
  });

  it("PlayingCard passes the tokens to the active deck's face", async () => {
    mockFaceProps.length = 0;
    await render(
      <ThemeProvider>
        <PlayingCard suit="hearts" rank={3} />
      </ThemeProvider>
    );
    expect(mockFaceProps.at(-1)).toMatchObject({
      cardBg: dark.cardFace,
      textColor: dark.cardInk,
      redSuitColor: dark.cardRedSuit,
      width: 52,
      height: 74,
    });
  });
});
