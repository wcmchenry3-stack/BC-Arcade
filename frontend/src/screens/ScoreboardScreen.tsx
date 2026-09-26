import React from "react";
import { View, StyleSheet } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { GameShell } from "../components/shared/GameShell";
import HeartsScoreboard from "../components/scoreboard/HeartsScoreboard";
import YachtScoreboard from "../components/scoreboard/YachtScoreboard";
import BlackjackScoreboard from "../components/scoreboard/BlackjackScoreboard";
import { useHeartsRounds } from "../game/hearts/RoundsContext";
import { useYachtScorecard } from "../game/yacht/ScorecardContext";
import { useBlackjackSessionStats } from "../game/blackjack/BlackjackGameContext";
import type { HomeStackParamList } from "../types/navigation";

type GameKey = HomeStackParamList["Scoreboard"]["gameKey"];

function HeartsScorecard() {
  const { cumulativeScores, scoreHistory, playerLabels } = useHeartsRounds();
  return (
    <HeartsScoreboard
      playerLabels={playerLabels}
      cumulativeScores={cumulativeScores}
      scoreHistory={scoreHistory}
    />
  );
}

function YachtScorecard() {
  const { scores, upperSubtotal, upperBonus, yachtBonusCount, totalScore } = useYachtScorecard();
  return (
    <YachtScoreboard you={{ scores, upperSubtotal, upperBonus, yachtBonusCount, totalScore }} />
  );
}

function BlackjackScorecard() {
  const stats = useBlackjackSessionStats();
  return <BlackjackScoreboard stats={stats} />;
}

/**
 * The live view of the match in progress, per game (#2636): the ⋯ menu's
 * "Scorecard" item. A player's history for a game is the Stats screen
 * (`GameStats`, #2635), not this one. Typed over the route's `gameKey`, so a
 * key without a live view can't be navigated to.
 */
export const SCORECARD_VIEWS: Readonly<Record<GameKey, React.ComponentType>> = {
  hearts: HeartsScorecard,
  yacht: YachtScorecard,
  blackjack: BlackjackScorecard,
};

export default function ScoreboardScreen() {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const route = useRoute<RouteProp<HomeStackParamList, "Scoreboard">>();
  const LiveView = SCORECARD_VIEWS[route.params.gameKey];

  return (
    <GameShell
      gameType={null}
      title={t("overflow.menu.scorecard")}
      onBack={() => navigation.goBack()}
    >
      <View style={styles.body}>
        <LiveView />
      </View>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  body: {
    flex: 1,
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
});
