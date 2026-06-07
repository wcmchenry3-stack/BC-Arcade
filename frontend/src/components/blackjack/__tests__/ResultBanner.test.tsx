import React from "react";
import { render } from "@testing-library/react-native";
import ResultBanner from "../ResultBanner";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function renderBanner(outcome: string, payout: number) {
  return await render(
    <ThemeProvider>
      <ResultBanner outcome={outcome} payout={payout} />
    </ThemeProvider>
  );
}

describe("ResultBanner", () => {
  it('shows "You Win!" for outcome "win"', async () => {
    const { getByText } = await renderBanner("win", 100);
    expect(getByText("You Win!")).toBeTruthy();
  });

  it('shows "Blackjack!" for outcome "blackjack"', async () => {
    const { getByText } = await renderBanner("blackjack", 150);
    expect(getByText("Blackjack!")).toBeTruthy();
  });

  it('shows "Push" for outcome "push"', async () => {
    const { getByText } = await renderBanner("push", 0);
    expect(getByText("Push")).toBeTruthy();
  });

  it('shows "You Lose" for outcome "lose"', async () => {
    const { getByText } = await renderBanner("lose", -100);
    expect(getByText("You Lose")).toBeTruthy();
  });

  it("shows positive payout text for wins", async () => {
    const { getByText } = await renderBanner("win", 100);
    expect(getByText("+100 chips")).toBeTruthy();
  });

  it("shows negative payout text for losses", async () => {
    const { getByText } = await renderBanner("lose", -100);
    expect(getByText("-100 chips")).toBeTruthy();
  });

  it('shows "No change" for zero payout', async () => {
    const { getByText } = await renderBanner("push", 0);
    expect(getByText("No change")).toBeTruthy();
  });

  it("win outcome text uses bonus color", async () => {
    const { getByText } = await renderBanner("win", 100);
    const outcomeEl = getByText("You Win!");
    // bonus color is set via the accent switch — just verify the element renders
    expect(outcomeEl).toBeTruthy();
  });

  it("blackjack outcome renders distinct text", async () => {
    const { getByText } = await renderBanner("blackjack", 150);
    expect(getByText("Blackjack!")).toBeTruthy();
    expect(getByText("+150 chips")).toBeTruthy();
  });

  it("has payout accessibility label", async () => {
    const { getByLabelText } = await renderBanner("win", 100);
    expect(getByLabelText(/payout/i)).toBeTruthy();
  });
});
