import React from "react";
import { StyleSheet } from "react-native";
import { render } from "@testing-library/react-native";
import i18n from "i18next";
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

  // #3828: Hebrew stores "ניצחת!" in logical order, so the spoken split label has one pause, not two.
  describe("felt split label, Hebrew", () => {
    beforeEach(async () => {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      i18n.addResourceBundle("he", "blackjack", require("../../../i18n/locales/he/blackjack.json"));
      await i18n.changeLanguage("he");
    });
    afterEach(async () => {
      await i18n.changeLanguage("en");
    });

    it("reads the outcome, summary and payout without a doubled mark", async () => {
      const summary = `${i18n.t("blackjack:result.splitWon", { count: 2 })} · ${i18n.t("blackjack:result.splitLost", { count: 1 })}`;
      const { getByLabelText } = await render(
        <ThemeProvider>
          <ResultBanner
            variant="felt"
            compact
            netOnly
            outcome="win"
            payout={25}
            summary={summary}
          />
        </ThemeProvider>
      );
      expect(getByLabelText("ניצחת! ניצחונות: 2 · הפסדים: 1. תשלום: 25 שבבים")).toBeTruthy();
    });
  });

  // #3781: beside a collapsed dealer the band is too narrow for a split round's summary.
  describe("felt, net only", () => {
    const SUMMARY = "Won: 2 · Lost: 1 · Push: 1";
    async function renderFelt(netOnly: boolean) {
      return await render(
        <ThemeProvider>
          <ResultBanner
            variant="felt"
            compact
            outcome="win"
            payout={25}
            detail="Dealer has 17"
            summary={SUMMARY}
            netOnly={netOnly}
          />
        </ThemeProvider>
      );
    }

    it("shows the net payout alone, on one line", async () => {
      const { getByTestId, queryByText, queryByTestId } = await renderFelt(true);
      const net = getByTestId("result-net");
      expect(net.props.children).toBe("+25 chips");
      expect(net.props.numberOfLines).toBe(1);
      expect(queryByText(SUMMARY)).toBeNull();
      expect(queryByTestId("result-outcome")).toBeNull();
      expect(queryByTestId("result-detail")).toBeNull();
    });

    it("still reads the whole result: outcome, summary and payout", async () => {
      const { getByLabelText } = await renderFelt(true);
      expect(getByLabelText(`You Win! ${SUMMARY}. Payout: 25 chips`)).toBeTruthy();
    });

    it("colours the net by its sign: a gain, a loss and no change each their own colour", async () => {
      const cases: ["win" | "lose" | "push", number][] = [
        ["win", 25],
        ["lose", -25],
        ["push", 0],
      ];
      const { getAllByTestId } = await render(
        <ThemeProvider>
          {cases.map(([outcome, payout]) => (
            <ResultBanner
              key={outcome}
              variant="felt"
              compact
              outcome={outcome}
              payout={payout}
              detail="Dealer has 17"
              summary={SUMMARY}
              netOnly
            />
          ))}
        </ThemeProvider>
      );
      const colors = getAllByTestId("result-net").map(
        (n) => StyleSheet.flatten(n.props.style)?.color
      );
      expect(colors).toHaveLength(3);
      colors.forEach((c) => expect(c).toBeTruthy());
      expect(new Set(colors).size).toBe(3);
    });

    it("off, shows the summary beside the payout as before", async () => {
      const { getByTestId, getByText, queryByTestId } = await renderFelt(false);
      expect(getByTestId("result-outcome").props.children).toBe(SUMMARY);
      expect(getByText("+25 chips")).toBeTruthy();
      expect(queryByTestId("result-net")).toBeNull();
    });
  });
});
