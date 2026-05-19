import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { GameShell } from "../components/shared/GameShell";
import { useTheme } from "../theme/ThemeContext";
import HeartsScoreboard from "../components/scoreboard/HeartsScoreboard";
import YachtScoreboard from "../components/scoreboard/YachtScoreboard";
import BlackjackScoreboard from "../components/scoreboard/BlackjackScoreboard";
import Twenty48Scoreboard from "../components/scoreboard/Twenty48Scoreboard";
import SolitaireScoreboard from "../components/scoreboard/SolitaireScoreboard";
import SudokuScoreboard from "../components/scoreboard/SudokuScoreboard";
import CascadeScoreboard from "../components/scoreboard/CascadeScoreboard";
import { useHeartsRounds } from "../game/hearts/RoundsContext";
import { useYachtScorecard } from "../game/yacht/ScorecardContext";
import { useBlackjackSessionStats } from "../game/blackjack/BlackjackGameContext";
import { useTwenty48Scoreboard } from "../game/twenty48/Twenty48ScoreboardContext";
import { useSolitaireScoreboard } from "../game/solitaire/SolitaireScoreboardContext";
import { useSudokuScoreboard } from "../game/sudoku/SudokuScoreboardContext";
import { useCascadeScoreboard } from "../game/cascade/CascadeScoreboardContext";
import type { HomeStackParamList } from "../types/navigation";

type GameKey = HomeStackParamList["Scoreboard"]["gameKey"];

function HeartsScoreboardSection() {
  const { cumulativeScores, scoreHistory, playerLabels } = useHeartsRounds();
  return (
    <HeartsScoreboard
      playerLabels={playerLabels}
      cumulativeScores={cumulativeScores}
      scoreHistory={scoreHistory}
    />
  );
}

function YachtScoreboardSection() {
  const { scores, upperSubtotal, upperBonus, yachtBonusCount, totalScore } = useYachtScorecard();
  return (
    <YachtScoreboard you={{ scores, upperSubtotal, upperBonus, yachtBonusCount, totalScore }} />
  );
}

function BlackjackScoreboardSection() {
  const stats = useBlackjackSessionStats();
  return <BlackjackScoreboard stats={stats} />;
}

function Twenty48ScoreboardSection() {
  const { snapshot } = useTwenty48Scoreboard();
  return <Twenty48Scoreboard snapshot={snapshot} />;
}

function SolitaireScoreboardSection() {
  const { snapshot } = useSolitaireScoreboard();
  return <SolitaireScoreboard snapshot={snapshot} />;
}

function SudokuScoreboardSection() {
  const { snapshot } = useSudokuScoreboard();
  return <SudokuScoreboard snapshot={snapshot} />;
}

function CascadeScoreboardSection() {
  const { snapshot } = useCascadeScoreboard();
  return <CascadeScoreboard snapshot={snapshot} />;
}

function UnknownScoreboardFallback({ gameKey }: { gameKey: string }) {
  const { colors } = useTheme();
  return (
    <View style={styles.fallback}>
      <Text style={[styles.fallbackText, { color: colors.textMuted }]}>
        No scoreboard available for &quot;{gameKey}&quot; yet.
      </Text>
    </View>
  );
}

export default function ScoreboardScreen() {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const route = useRoute<RouteProp<HomeStackParamList, "Scoreboard">>();
  const gameKey: GameKey = route.params.gameKey;

  let body: React.ReactNode;
  switch (gameKey) {
    case "hearts":
      body = <HeartsScoreboardSection />;
      break;
    case "yacht":
      body = <YachtScoreboardSection />;
      break;
    case "blackjack":
      body = <BlackjackScoreboardSection />;
      break;
    case "twenty48":
      body = <Twenty48ScoreboardSection />;
      break;
    case "solitaire":
      body = <SolitaireScoreboardSection />;
      break;
    case "sudoku":
      body = <SudokuScoreboardSection />;
      break;
    case "cascade":
      body = <CascadeScoreboardSection />;
      break;
    default:
      body = <UnknownScoreboardFallback gameKey={gameKey} />;
  }

  return (
    <GameShell title={t("overflow.menu.scoreboard")} onBack={() => navigation.goBack()}>
      <View style={styles.body}>{body}</View>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  fallback: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  fallbackText: {
    fontSize: 14,
  },
});
