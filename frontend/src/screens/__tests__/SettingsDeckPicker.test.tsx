/**
 * #3577: with BC_DECK_ENABLED on, all six decks are listed in the Settings deck picker and
 * Synthwave can be selected. The pills sit on their own line and wrap, so the later decks are
 * not pushed off a phone-width screen.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SettingsScreen from "../SettingsScreen";

const mockSetDeck = jest.fn();
const IDS = ["minimal", "classic", "neon", "arcade", "parlor", "synthwave"];
jest.mock("../../game/_shared/decks/CardDeckContext", () => ({
  useDeck: () => ({
    activeDeck: { id: "classic", name: "Classic" },
    setDeck: (id: string) => mockSetDeck(id),
    availableDecks: IDS,
  }),
}));

jest.mock("../../components/LanguageSwitcher", () => ({
  __esModule: true,
  default: "MockLanguageSwitcher",
}));

describe("Settings deck picker", () => {
  beforeEach(() => mockSetDeck.mockClear());

  it("lists all six decks and selects Synthwave", async () => {
    await render(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>
    );
    for (const id of IDS) expect(screen.getByTestId(`deck-pill-${id}`)).toBeTruthy();
    expect(screen.getByText("Synthwave")).toBeTruthy();
    expect(screen.getByText("Arcade")).toBeTruthy();
    expect(screen.getByText("Parlor")).toBeTruthy();

    await fireEvent.press(screen.getByTestId("deck-pill-synthwave"));
    expect(mockSetDeck).toHaveBeenCalledWith("synthwave");
  });

  it("wraps the pills on their own line under the label", async () => {
    await render(
      <ThemeProvider>
        <SettingsScreen />
      </ThemeProvider>
    );
    const group = screen.getByTestId("deck-pill-synthwave").parent!;
    expect(StyleSheet.flatten(group.props.style)).toMatchObject({
      flexDirection: "row",
      flexWrap: "wrap",
    });
    expect(StyleSheet.flatten(group.parent!.props.style)).toMatchObject({
      flexDirection: "column",
    });
  });
});
