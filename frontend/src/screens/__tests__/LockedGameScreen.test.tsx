/**
 * #2956: the screen an unentitled session sees on a premium route (App.tsx's premium guard,
 * #1055). It explains the lock and offers one way out: back to the lobby.
 */
import React from "react";
import { fireEvent, render, screen } from "@testing-library/react-native";

import LockedGameScreen from "../LockedGameScreen";
import { ThemeProvider } from "../../theme/ThemeContext";

const mockGoBack = jest.fn();
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ goBack: mockGoBack, navigate: jest.fn() }))
);

beforeEach(() => mockGoBack.mockClear());

describe("LockedGameScreen", () => {
  it("explains that the game needs a subscription", async () => {
    await render(
      <ThemeProvider>
        <LockedGameScreen />
      </ThemeProvider>
    );
    expect(screen.getByText("Locked")).toBeTruthy();
    expect(screen.getByText("🔒")).toBeTruthy();
    expect(screen.getByText("Premium Game")).toBeTruthy();
    expect(screen.getByText("This game requires a BC Arcade subscription.")).toBeTruthy();
  });

  it("'Back to Lobby' goes back", async () => {
    await render(<LockedGameScreen />);
    const back = screen.getByRole("button", { name: "Go back to lobby" });
    expect(back).toHaveTextContent("Back to Lobby");
    await fireEvent.press(back);
    expect(mockGoBack).toHaveBeenCalledTimes(1);
  });
});
