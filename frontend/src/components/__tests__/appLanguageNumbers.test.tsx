import React from "react";
import { cleanup, render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import { ThemeProvider } from "../../theme/ThemeContext";
import HudSidebar from "../blackjack/HudSidebar";
import BettingCircle from "../blackjack/BettingCircle";
import ScoreDisplay from "../cascade/ScoreDisplay";
import BlackjackScorecard from "../scorecard/BlackjackScorecard";
import { initialSessionStats } from "../../game/blackjack/sessionStats";

// #2767: numbers follow the app's language, not the device's. The device
// locale here is en-US (Node's default); the app language is German.
describe("blackjack and cascade numbers follow the app language (#2767)", () => {
  beforeEach(async () => {
    // Pin the device side to en-US so the result cannot depend on the host LANG.
    jest.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (this: number) {
      return new Intl.NumberFormat("en-US").format(this);
    });
    await i18n.changeLanguage("de");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await cleanup();
    await i18n.changeLanguage("en");
  });

  const wrap = (ui: React.ReactElement) => <ThemeProvider>{ui}</ThemeProvider>;

  it("HudSidebar groups chips and the run goal", async () => {
    await render(
      wrap(
        <HudSidebar
          chips={1200}
          startingChips={1000}
          runGoal={25000}
          milestones={[]}
          tableName="T"
          tableAccentColor="#fff"
        />
      )
    );
    expect(screen.getByText("1.200")).toBeTruthy();
    expect(screen.getByText(/25\.000/)).toBeTruthy();
    expect(screen.queryByText("1,200")).toBeNull();
    expect(screen.getByLabelText("Goal progress: 1.200 of 25.000 chips")).toBeTruthy();
  });

  it("BettingCircle groups the bet", async () => {
    await render(wrap(<BettingCircle bet={1200} />));
    expect(screen.getByLabelText("Current bet: 1.200 chips")).toBeTruthy();
    expect(screen.getByText("1.200")).toBeTruthy();
  });

  it("Cascade ScoreDisplay groups the score", async () => {
    await render(wrap(<ScoreDisplay score={1200} />));
    expect(screen.getByText("1.200")).toBeTruthy();
    expect(screen.queryByText("1,200")).toBeNull();
  });

  it("BlackjackScorecard groups chips, biggest win and P/L", async () => {
    const stats = { ...initialSessionStats(1000), chips: 2500, biggestWin: 1200, plChips: 1500 };
    await render(wrap(<BlackjackScorecard stats={stats} />));
    expect(screen.getByText("2.500")).toBeTruthy();
    expect(screen.getByText("+1.200")).toBeTruthy();
    expect(screen.getByText("+1.500 chips")).toBeTruthy();
    expect(screen.queryByText("+1,500 chips")).toBeNull();
  });
});
