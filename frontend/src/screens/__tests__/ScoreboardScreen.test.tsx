import React from "react";
import { render, act } from "@testing-library/react-native";
import ScoreboardScreen from "../ScoreboardScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { HeartsRoundsProvider, useHeartsRounds } from "../../game/hearts/RoundsContext";
import { YachtScorecardProvider, useYachtScorecard } from "../../game/yacht/ScorecardContext";
import { initialSessionStats } from "../../game/blackjack/sessionStats";

jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
  useRoute: jest.fn(),
}));

// Mock the blackjack session-stats hook so the test doesn't need to mount
// BlackjackGameProvider (which would trigger loadGame + useGameSync side
// effects). The variant only reads sessionStats; this is the minimum.
jest.mock("../../game/blackjack/BlackjackGameContext", () => ({
  useBlackjackSessionStats: jest.fn(),
}));

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useRoute } = require("@react-navigation/native");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { useBlackjackSessionStats } = require("../../game/blackjack/BlackjackGameContext");

async function renderScreen() {
  return await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <YachtScorecardProvider>
          <ScoreboardScreen />
        </YachtScorecardProvider>
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
}

// Tiny seed component so we can populate the rounds context before
// ScoreboardScreen reads from it.
function Seed({
  cumulativeScores,
  scoreHistory,
  playerLabels,
}: {
  cumulativeScores: number[];
  scoreHistory: number[][];
  playerLabels: string[];
}) {
  const { setSnapshot } = useHeartsRounds();
  React.useEffect(() => {
    setSnapshot({ cumulativeScores, scoreHistory, playerLabels });
  }, [cumulativeScores, scoreHistory, playerLabels, setSnapshot]);
  return null;
}

async function renderWithSeed(seedProps: {
  cumulativeScores: number[];
  scoreHistory: number[][];
  playerLabels: string[];
}) {
  return await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <YachtScorecardProvider>
          <Seed {...seedProps} />
          <ScoreboardScreen />
        </YachtScorecardProvider>
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
}

function YachtSeed({
  scores,
  totalScore,
}: {
  scores: Record<string, number | null>;
  totalScore: number;
}) {
  const { setSnapshot } = useYachtScorecard();
  React.useEffect(() => {
    setSnapshot({
      scores,
      upperSubtotal: 0,
      upperBonus: 0,
      yachtBonusCount: 0,
      totalScore,
    });
  }, [scores, totalScore, setSnapshot]);
  return null;
}

async function renderYachtWithSeed(scores: Record<string, number | null>, totalScore: number) {
  return await render(
    <ThemeProvider>
      <HeartsRoundsProvider>
        <YachtScorecardProvider>
          <YachtSeed scores={scores} totalScore={totalScore} />
          <ScoreboardScreen />
        </YachtScorecardProvider>
      </HeartsRoundsProvider>
    </ThemeProvider>
  );
}

describe("ScoreboardScreen", () => {
  beforeEach(() => {
    useRoute.mockReset();
  });

  it("renders the Hearts variant when gameKey is hearts", async () => {
    useRoute.mockReturnValue({ params: { gameKey: "hearts" } });
    const utils = await renderWithSeed({
      cumulativeScores: [13, 25, 41, 59],
      scoreHistory: [],
      playerLabels: ["You", "West", "North", "East"],
    });
    await act(() => {
      // flush the seed effect
    });
    // Hearts variant exposes single-letter header initials.
    expect(utils.getByText("Y")).toBeTruthy();
    expect(utils.getByText(/shooter zeroes/)).toBeTruthy();
  });

  it("renders the Yacht variant when gameKey is yacht", async () => {
    useRoute.mockReturnValue({ params: { gameKey: "yacht" } });
    const { getByText } = await renderYachtWithSeed(
      { ones: 3, twos: null, full_house: null, yacht: 50 },
      53
    );
    await act(() => {
      // flush the seed effect
    });
    // Yacht variant renders the scored values plus the upper-bonus countdown.
    expect(getByText("3")).toBeTruthy();
    expect(getByText("50")).toBeTruthy();
    expect(getByText(/more for \+35/)).toBeTruthy();
  });

  it("renders the Blackjack variant when gameKey is blackjack", async () => {
    useRoute.mockReturnValue({ params: { gameKey: "blackjack" } });
    useBlackjackSessionStats.mockReturnValue({
      ...initialSessionStats(1000),
      chips: 2240,
      plChips: 1240,
      handsPlayed: 13,
      handsWon: 8,
      handsLost: 4,
      handsPushed: 1,
      blackjacks: 2,
      busts: 1,
      biggestWin: 75,
    });
    const { getByText } = await renderScreen();
    // Hero P/L line in i18n template "+1,240 chips".
    expect(getByText(/\+1,240/)).toBeTruthy();
    // Stat-card values present.
    expect(getByText("2,240")).toBeTruthy();
    expect(getByText("8")).toBeTruthy();
  });

  it("renders a fallback for an entirely unknown gameKey", async () => {
    useRoute.mockReturnValue({ params: { gameKey: "no-such-game" } });
    const { getByText } = await renderScreen();
    expect(getByText(/No scoreboard available for/)).toBeTruthy();
  });
});
