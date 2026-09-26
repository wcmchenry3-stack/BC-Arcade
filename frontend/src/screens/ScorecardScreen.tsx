import React from "react";
import { View, StyleSheet } from "react-native";
import { useNavigation, useRoute } from "@react-navigation/native";
import type { RouteProp } from "@react-navigation/native";
import { useTranslation } from "react-i18next";
import { GameShell } from "../components/shared/GameShell";
import { EmptyState } from "../components/shared/EmptyState";
import HeartsScorecard from "../components/scorecard/HeartsScorecard";
import YachtScorecard from "../components/scorecard/YachtScorecard";
import BlackjackScorecard from "../components/scorecard/BlackjackScorecard";
import { useHeartsRounds } from "../game/hearts/RoundsContext";
import { useYachtScorecard } from "../game/yacht/ScorecardContext";
import { useBlackjackSessionStats } from "../game/blackjack/BlackjackGameContext";
import { hasScorecard, type ScorecardGame } from "../navigation/scorecards";
import type { HomeStackParamList } from "../types/navigation";

function HeartsLiveView() {
  const { cumulativeScores, scoreHistory, playerLabels } = useHeartsRounds();
  return (
    <HeartsScorecard
      playerLabels={playerLabels}
      cumulativeScores={cumulativeScores}
      scoreHistory={scoreHistory}
    />
  );
}

function YachtLiveView() {
  const { scores, upperSubtotal, upperBonus, yachtBonusCount, totalScore } = useYachtScorecard();
  return (
    <YachtScorecard you={{ scores, upperSubtotal, upperBonus, yachtBonusCount, totalScore }} />
  );
}

function BlackjackLiveView() {
  const stats = useBlackjackSessionStats();
  return <BlackjackScorecard stats={stats} />;
}

/**
 * The live view of the match in progress, per game (#2636): the ⋯ menu's
 * "Scorecard" item. A player's history for a game is the Stats screen
 * (`GameStats`, #2635), not this one. Keyed by `SCORECARD_GAMES`, so every
 * game listed there has a view.
 */
export const SCORECARD_VIEWS: Readonly<Record<ScorecardGame, React.ComponentType>> = {
  hearts: HeartsLiveView,
  yacht: YachtLiveView,
  blackjack: BlackjackLiveView,
};

export default function ScorecardScreen() {
  const { t } = useTranslation("common");
  const navigation = useNavigation();
  const route = useRoute<RouteProp<HomeStackParamList, "Scorecard">>();
  // Typed, but navigation state can still arrive with a key that has no live
  // view (an untyped navigate, or state from an older build): say so rather
  // than crash (as LeaderboardScreen does, #2731).
  const gameKey: unknown = route.params?.gameKey;
  const LiveView =
    typeof gameKey === "string" && hasScorecard(gameKey) ? SCORECARD_VIEWS[gameKey] : null;

  return (
    <GameShell
      gameType={null}
      title={t("overflow.menu.scorecard")}
      requireBack
      onBack={() => navigation.goBack()}
    >
      {LiveView ? (
        <View style={styles.body}>
          <LiveView />
        </View>
      ) : (
        <EmptyState
          kind="empty"
          message={t("scorecard.unavailable")}
          testID="scorecard-unavailable"
        />
      )}
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
