/**
 * GameScreen — Yacht, solo or against the computer (VS mode).
 *
 * Layers:
 *   1. Pure engine (`game/yacht/engine.ts`): the screen holds the player's
 *      `GameState` and applies roll / hold / score to it locally.
 *   2. Mode picker (#1129): shown once per fresh game; Solo or VS at a
 *      difficulty, opened on the ones last played (`useYachtModePicker`, on
 *      the shared `useLastDifficulty`). The session starts only once a mode
 *      is chosen (#2710).
 *   3. Computer opponent (#2981): `useYachtCpuOpponent` owns the computer's
 *      scorecard and its paced turn loop, started after each player score
 *      and resumed for a game killed mid-turn (#2203). The screen keeps the
 *      one AppState listener and forwards backgrounding to it (#1850).
 *   4. Persistence: `saveGame` after every change (player, difficulty,
 *      computer, finished game id); cleared on a new game.
 *   5. Instrumentation (#368 / #549): `useGameSync("yacht")`. Solo completes
 *      on the last score; VS completes with the result once the computer has
 *      finished too, or records the finished game on unmount / background
 *      while it is still playing (#2505).
 *   6. Result + leaderboard (#2630 / #2633): the shared GameResultModal,
 *      ranked by the finished game's session id.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { AppState, View, Text, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import { RouteProp } from "@react-navigation/native";
import type { HomeStackParamList } from "../types/navigation";
import { GameState } from "../game/yacht/types";
import type { AiDifficulty } from "../game/yacht/types";
import {
  newGame,
  roll as engineRoll,
  score as engineScore,
  toggleHold as engineToggleHold,
  possibleScores as enginePossibleScores,
  isInProgress,
  Category,
} from "../game/yacht/engine";
import { isAiTurnPending } from "../game/yacht/vsTurn";
import { saveGame, clearGame } from "../game/yacht/storage";
import { useYachtCpuOpponent } from "../game/yacht/useYachtCpuOpponent";
import { useYachtModePicker } from "../game/yacht/useYachtModePicker";
import { isPremiumLevel } from "../entitlements/premiumLevels";
import { useYachtScorecard } from "../game/yacht/ScorecardContext";
import { useGameSync } from "../game/_shared/useGameSync";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useSound } from "../game/_shared/useSound";
import { YACHT_SOUNDS } from "../game/yacht/sounds";
import * as Sentry from "@sentry/react-native";
import DiceRow from "../components/DiceRow";
import Scorecard from "../components/Scorecard";
import VsScorecard from "../components/yacht/VsScorecard";
import GameResultModal, { type GameOutcome } from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import { buildEndedPayload } from "../game/yacht/resultPayload";
import YachtFinalScorecard from "../components/yacht/YachtFinalScorecard";
import AiDifficultySelector from "../components/yacht/AiDifficultySelector";
import ModeButton from "../components/yacht/ModeButton";
import YachtDevPanel from "../components/yacht/YachtDevPanel";
import { YachtCelebrationAnimation } from "../components/yacht/YachtCelebrationAnimation";
import NewGameConfirmModal from "../components/shared/NewGameConfirmModal";
import { ModalCard } from "../components/shared/ModalCard";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { PillButton } from "../components/shared/PillButton";
import { isAwayStatus } from "../hooks/usePauseWhileAway";

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "Game">;
  route: RouteProp<HomeStackParamList, "Game">;
};

/**
 * The session's creation metadata (#2630): the mode, and in vs mode the
 * computer's difficulty. Recorded only — both modes share one board.
 */
function sessionMetadata(aiDifficulty: AiDifficulty | null): Record<string, unknown> {
  return aiDifficulty ? { mode: "vs", difficulty: aiDifficulty } : { mode: "solo" };
}

/** Who won a finished vs-CPU game, from the player's side (#2505, #2517). */
function vsOutcome(player: GameState, cpu: GameState): "win" | "loss" | "draw" {
  return player.total_score > cpu.total_score
    ? "win"
    : player.total_score < cpu.total_score
      ? "loss"
      : "draw";
}

export default function GameScreen({ navigation, route }: Props) {
  const { t } = useTranslation(["yacht", "common"]);
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const [gameState, setGameState] = useState<GameState>(route.params.initialState);
  const [possibleScores, setPossibleScores] = useState<Record<string, number>>({});
  const [gameKey, setGameKey] = useState(0);
  const [confirmNewGameVisible, setConfirmNewGameVisible] = useState(false);
  const [showYachtCelebration, setShowYachtCelebration] = useState(false);
  const [showJokerCelebration, setShowJokerCelebration] = useState(false);
  const [rollingIndices, setRollingIndices] = useState<readonly number[]>([]);
  const [devOpen, setDevOpen] = useState(false);
  // Dev panel: dice to force on the next human roll; consumed (cleared) by handleRoll.
  const devDiceOverrideRef = useRef<number[] | null>(null);

  // VS mode: difficulty selector overlay shown once per fresh game.
  const isFreshGame =
    route.params.initialState.round === 1 &&
    route.params.initialState.rolls_used === 0 &&
    !route.params.initialState.game_over;
  const [difficultyChosen, setDifficultyChosen] = useState(
    !isFreshGame || route.params.aiDifficulty !== undefined
  );
  // The picker opens on the mode and VS difficulty last played (#1129).
  const modePicker = useYachtModePicker();
  const { reload: reloadModePicker } = modePicker;
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty | null>(
    route.params.aiDifficulty ?? null
  );
  // The computer's scorecard and turn loop. A restored game may have been
  // killed mid-AI-turn: resume it (#2203).
  const {
    state: aiGameState,
    setState: setAiGameState,
    stateRef: aiGameStateRef,
    difficultyRef: aiDifficultyRef,
    isTurn: isAiTurn,
    rollingIndices: aiRollingIndices,
    startTurn: startAiTurn,
    endTurn: endAiTurn,
    onAppBackground: onCpuAppBackground,
  } = useYachtCpuOpponent({
    difficulty: aiDifficulty,
    initialState: route.params.aiState ?? null,
    resumeTurn:
      !!route.params.aiDifficulty &&
      !!route.params.aiState &&
      isAiTurnPending(route.params.initialState, route.params.aiState),
  });

  // Keep a ref in sync for callbacks.
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // #2505: in vs mode the session completes only once the CPU has finished
  // (so the result can be reported). While the CPU is still playing its last
  // turn, the player's finished game is recorded without the result instead:
  //  - on unmount, so useGameSync's unmount handler doesn't record it as
  //    abandoned (this effect is declared before useGameSync so its cleanup
  //    runs first), and
  //  - when the app is backgrounded, because a swipe-away or OS kill runs no
  //    cleanup and a relaunched finished game never resumes the CPU turn.
  // syncComplete is idempotent, so the later full completion is a no-op.
  const completeIfCpuStillPlayingRef = useRef<() => void>(() => {});
  useEffect(() => () => completeIfCpuStillPlayingRef.current(), []);

  // Game event instrumentation (#368 / #549).
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    enqueue: syncEnqueue,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
    resetPlayWindow: syncResetPlayWindow,
  } = useGameSync("yacht");

  // Result card leaderboard line (#2630): the finished session row ranks on
  // its own; the card only asks where it landed.
  // The card's rank line, "View leaderboard" link and ⋯ menu item (#2633).
  const { leaderboard, openLeaderboard } = useGameLeaderboard("yacht", navigation);
  const { lookup: lookupRank, reset: resetRank } = leaderboard;
  // The finished game's session id, captured when the player's game ends —
  // complete() clears the hook's id, and in vs mode (or on a background during
  // the CPU's last turn) it runs before the card shows. Saved with the game,
  // so a game reopened with only the CPU's last turn left still finds its
  // rank; such a game only looks the rank up, it never submits anything.
  const [finishedGameId, setFinishedGameId] = useState<string | null>(
    route.params.initialState.game_over ? (route.params.finishedGameId ?? null) : null
  );

  // Sound hooks
  const { play: playDiceRoll } = useSound("yacht.diceRoll", YACHT_SOUNDS);
  const { play: playDieHold } = useSound("yacht.dieHold", YACHT_SOUNDS);
  const { play: playYacht } = useSound("yacht.yacht", YACHT_SOUNDS);
  const { play: playJoker } = useSound("yacht.joker", YACHT_SOUNDS);
  const { play: playStraight } = useSound("yacht.straight", YACHT_SOUNDS);
  const { play: playUpperBonus } = useSound("yacht.upperBonus", YACHT_SOUNDS);

  function endedPayload(
    s: GameState,
    outcome: "completed" | "abandoned",
    opponent?: GameState | null
  ) {
    // #2505: vs-mode games report who won once the CPU has finished (#2517:
    // the row records who won, a tie is `push`). #2839: both scorecards go in.
    return buildEndedPayload(s, outcome, opponent, vsOutcome, recordedOutcome);
  }

  // #2839: the hook's own abandons (unmount, navigation) carry the partial
  // scorecard too, built by the same helper as the New Game abandon. An
  // abandoned row never ranks and is excluded from progression and the daily
  // challenge, so this only adds the saved detail. The row's score column is
  // untouched: the snapshot has no `finalScore`.
  useEffect(() => {
    syncSetProgressSnapshot(() => ({
      result: endedPayload(gameStateRef.current, "abandoned"),
    }));
  }, [syncSetProgressSnapshot]);

  // When the mode modal is shown on first render we defer syncStart to the
  // handler so the session only starts once the player has chosen a mode.
  const syncOnMount = !isFreshGame || route.params.aiDifficulty !== undefined;
  useEffect(() => {
    if (gameStateRef.current.game_over) return;
    if (!syncOnMount) return;
    // A restored game continues the session a killed app left open (#2654).
    if (!isFreshGame && syncResume()) return;
    syncStart(undefined, sessionMetadata(route.params.aiDifficulty ?? null));
    // Unmount abandon is handled by useGameSync.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist state after every change (includes AI difficulty and AI state for VS mode).
  useEffect(() => {
    saveGame(gameState, aiDifficulty, aiGameState, finishedGameId);
  }, [gameState, aiDifficulty, aiGameState, finishedGameId]);

  // Sync snapshot to shared scorecard context (read by ScorecardScreen).
  const { setSnapshot: setScorecardSnapshot } = useYachtScorecard();
  useEffect(() => {
    setScorecardSnapshot({
      scores: gameState.scores,
      upperSubtotal: gameState.upper_subtotal,
      upperBonus: gameState.upper_bonus,
      yachtBonusCount: gameState.yacht_bonus_count,
      totalScore: gameState.total_score,
    });
  }, [gameState, setScorecardSnapshot]);

  // Recompute possibleScores locally from state
  useEffect(() => {
    setPossibleScores(enginePossibleScores(gameState));
  }, [gameState]);

  // Process game events — play sounds, trigger animations, then clear
  useGameEvents(
    gameState.events,
    {
      diceRoll: (e) => {
        playDiceRoll();
        setRollingIndices(e.rolledIndices);
        setTimeout(() => setRollingIndices([]), 400);
      },
      dieHold: () => playDieHold(),
      dieRelease: () => playDieHold(),
      yacht: () => {
        playYacht();
        setShowYachtCelebration(true);
      },
      joker: () => {
        playJoker();
        setShowJokerCelebration(true);
      },
      largeStraight: () => playStraight(),
      smallStraight: () => playStraight(),
      upperBonus: () => playUpperBonus(),
    },
    () => setGameState((prev) => (prev === null ? prev : { ...prev, events: undefined }))
  );

  // Single mount-time AppState listener — clears animation state on background.
  // The async AI turn keeps running; no cancellation or replay needed.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (isAwayStatus(next)) {
        onCpuAppBackground();
        // The process may be killed from here (#2505). "inactive" too: iOS's
        // app switcher only makes the app inactive, and a swipe-away there
        // kills it without it ever reaching "background".
        completeIfCpuStillPlayingRef.current();
      }
    });
    return () => sub.remove();
  }, [onCpuAppBackground]);

  function handleRoll() {
    if (isAiTurn) return;
    setError(null);
    syncMarkStarted();
    try {
      const diceOverride = devDiceOverrideRef.current;
      devDiceOverrideRef.current = null;
      const next = engineRoll(
        gameState,
        gameState.held,
        diceOverride ? { dice: diceOverride } : undefined
      );
      setGameState(next);
      syncEnqueue({
        type: "roll",
        data: {
          held: [...next.held],
          dice: [...next.dice],
          rolls_used_after: next.rolls_used,
        },
      });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  function handleToggleHold(index: number) {
    if (isAiTurn) return;
    const next = engineToggleHold(gameState, index);
    if (next !== gameState) setGameState(next);
  }

  function handleScore(category: string) {
    if (isAiTurn) return;
    setError(null);
    try {
      const prev = gameState;
      const alternatives = possibleScores;
      const next = engineScore(prev, category as Category);
      setGameState(next);
      const value = next.scores[category as Category] ?? 0;
      const isJoker = next.yacht_bonus_count > prev.yacht_bonus_count;
      syncEnqueue({
        type: "score",
        data: {
          category,
          value,
          is_joker: isJoker,
          available_alternatives: alternatives,
        },
      });
      if (next.game_over) {
        if (aiDifficultyRef.current && aiGameStateRef.current) {
          // VS mode: the CPU takes its last turn first; the session completes
          // with the result once it has (see the effect on gameReallyOver).
          // The card's rank lookup needs this game's id (#2630), and the
          // session isn't closed yet for complete() to hand it back — read
          // the still-open id now, before the CPU (or an unmount/background,
          // via completeIfCpuStillPlayingRef) closes it.
          setFinishedGameId(syncGetGameId());
          startAiTurn();
        } else {
          const payload = endedPayload(next, "completed");
          setFinishedGameId(
            syncComplete(
              { finalScore: next.total_score, outcome: "completed", result: payload },
              payload
            )
          );
        }
      } else if (aiDifficultyRef.current && aiGameStateRef.current) {
        startAiTurn();
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const [error, setError] = useState<string | null>(null);

  const resetGame = useCallback(
    async (keepMode: boolean) => {
      const prev = gameStateRef.current;
      const keptDifficulty = keepMode ? aiDifficultyRef.current : null;
      // Play Again at a difficulty that has since become premium goes to the mode picker (#1129).
      const keep = keepMode && !(keptDifficulty && isPremiumLevel("yacht", keptDifficulty));
      Sentry.addBreadcrumb({
        category: "yacht.game",
        message: "startNewGame: resetting",
        data: {
          round: prev.round,
          game_over: prev.game_over,
          upper_subtotal: prev.upper_subtotal,
          total_score: prev.total_score,
        },
        level: "info",
      });
      const outcome = prev.game_over ? "completed" : "abandoned";
      const payload = endedPayload(prev, outcome, aiGameStateRef.current);
      syncComplete({ finalScore: prev.total_score, outcome, result: payload }, payload);
      // The next game gets its own leaderboard line.
      resetRank();
      await clearGame();
      setFinishedGameId(null);
      setGameState(newGame());
      endAiTurn();
      setGameKey((k) => k + 1);
      setError(null);
      if (keep) {
        // Play Again: same mode and difficulty, straight into a new game.
        setAiDifficulty(keptDifficulty);
        setAiGameState(keptDifficulty ? newGame() : null);
        setDifficultyChosen(true);
        syncStart(undefined, sessionMetadata(keptDifficulty));
      } else {
        await reloadModePicker();
        setAiDifficulty(null);
        setAiGameState(null);
        setDifficultyChosen(false);
        // syncStart is called in handleChooseSolo / handleChooseVs after the
        // player confirms a mode, so the session only starts once mode is known.
      }
      Sentry.addBreadcrumb({
        category: "yacht.game",
        message: "startNewGame: reset complete",
        level: "info",
      });
    },
    [
      syncComplete,
      syncStart,
      resetRank,
      endAiTurn,
      reloadModePicker,
      setAiGameState,
      aiDifficultyRef,
      aiGameStateRef,
    ]
  );

  /** New game via the mode picker (header New Game, Change Difficulty). */
  const startNewGame = useCallback(() => resetGame(false), [resetGame]);
  /** Play Again: same mode and difficulty. */
  const playAgain = useCallback(() => resetGame(true), [resetGame]);

  const handleNewGamePress = useCallback(() => {
    if (isInProgress(gameStateRef.current)) {
      setConfirmNewGameVisible(true);
    } else {
      void startNewGame();
    }
  }, [startNewGame]);

  const handleConfirmNewGame = useCallback(() => {
    setConfirmNewGameVisible(false);
    void startNewGame();
  }, [startNewGame]);

  /**
   * The game begins once a mode is chosen: time on the mode picker is not play
   * (#2710). With a session open, syncStart() closes it and starts the window
   * over itself, so the window is only reset when none is.
   */
  function startChosenGame(difficulty: AiDifficulty | null) {
    if (!syncGetGameId()) syncResetPlayWindow();
    syncStart(undefined, sessionMetadata(difficulty));
  }

  // VS mode: choose Solo or VS difficulty before first roll.
  function handleChooseSolo() {
    // Keeps the last VS difficulty played, so the next VS game still opens on it (#1129).
    modePicker.chooseSolo();
    setDifficultyChosen(true);
    startChosenGame(null);
  }

  function handleChooseVs() {
    const difficulty = modePicker.chooseVs();
    setAiDifficulty(difficulty);
    setAiGameState(newGame());
    setDifficultyChosen(true);
    startChosenGame(difficulty);
  }

  // VS result computed when both games are complete.
  const vsResult: "win" | "lose" | "tie" | undefined =
    aiDifficulty && gameState.game_over && aiGameState?.game_over
      ? gameState.total_score > aiGameState.total_score
        ? "win"
        : gameState.total_score < aiGameState.total_score
          ? "lose"
          : "tie"
      : undefined;

  // Modal visible only when both players have finished in VS mode.
  const gameReallyOver = gameState.game_over && (!aiDifficulty || aiGameState?.game_over === true);

  // #2505: complete a vs-mode session once both players have finished, with
  // the result. (Solo completes in handleScore.) syncComplete is idempotent.
  useEffect(() => {
    if (!aiDifficulty || !gameReallyOver || !aiGameState) return;
    const payload = endedPayload(gameState, "completed", aiGameState);
    syncComplete(
      {
        finalScore: gameState.total_score,
        outcome: recordedOutcome(vsOutcome(gameState, aiGameState)),
        result: payload,
      },
      payload
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameReallyOver, aiDifficulty]);

  // The result card's leaderboard line (#2630), once the game is really over
  // (after the vs completion above). Never on an abandon: an abandoned game
  // never reaches game over, so it never sets finishedGameId.
  useEffect(() => {
    if (gameReallyOver && finishedGameId) void lookupRank(finishedGameId);
  }, [gameReallyOver, finishedGameId, lookupRank]);

  completeIfCpuStillPlayingRef.current = () => {
    // Player done, CPU still playing its last turn: record the finished game.
    if (aiDifficulty && gameState.game_over && !aiGameState?.game_over) {
      const payload = endedPayload(gameState, "completed");
      syncComplete(
        { finalScore: gameState.total_score, outcome: "completed", result: payload },
        payload
      );
    }
  };

  const resultOutcome: GameOutcome =
    vsResult === "win"
      ? "win"
      : vsResult === "lose"
        ? "loss"
        : vsResult === "tie"
          ? "draw"
          : "ended";
  const margin = aiGameState ? Math.abs(gameState.total_score - aiGameState.total_score) : 0;
  const resultSubtitle =
    vsResult === "win"
      ? tResult("margin.won", { count: margin })
      : vsResult === "lose"
        ? tResult("margin.lost", { count: margin })
        : vsResult === "tie"
          ? tResult("margin.tied", { score: gameState.total_score })
          : gameState.yacht_bonus_total > 0
            ? t("gameOver.yachtBonus", {
                count: gameState.yacht_bonus_count,
                total: gameState.yacht_bonus_total,
              })
            : gameState.upper_bonus > 0
              ? t("gameOver.upperBonus")
              : undefined;
  const bonusTotal = gameState.upper_bonus + gameState.yacht_bonus_total;
  const lowerTotal = gameState.total_score - gameState.upper_subtotal - bonusTotal;

  function renderScorecard(which: "player" | "opponent") {
    const s = which === "player" ? gameState : aiGameState!;
    return (
      <Scorecard
        key={which === "player" ? gameKey : `ai-${gameKey}`}
        scores={s.scores}
        possibleScores={which === "player" ? possibleScores : {}}
        rollsUsed={s.rolls_used}
        gameOver={s.game_over}
        upperSubtotal={s.upper_subtotal}
        upperBonus={s.upper_bonus}
        yachtBonusCount={s.yacht_bonus_count}
        yachtBonusTotal={s.yacht_bonus_total}
        totalScore={s.total_score}
        onScore={which === "player" ? handleScore : () => {}}
        locked={which === "opponent" || isAiTurn}
      />
    );
  }

  const roundPill = (
    <View
      style={[styles.roundPill, { backgroundColor: colors.surfaceAlt, borderColor: colors.accent }]}
    >
      <Text style={[styles.roundPillText, { color: colors.accent }]}>
        {t("round.header", { round: Math.min(gameState.round, 13) })}
      </Text>
    </View>
  );

  return (
    <GameShell
      gameType="yacht"
      title={t("game.title")}
      rightSlot={roundPill}
      requireBack
      onNewGame={startNewGame}
      onOpenLeaderboard={openLeaderboard}
      error={error}
      gutter={16}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
      }}
    >
      {/* New Game */}
      <View style={styles.actionRow}>
        <PillButton label={t("common:newGame.button")} onPress={handleNewGamePress} />
      </View>

      {/* VS mode turn indicator */}
      {aiDifficulty && difficultyChosen && (
        <View
          style={[
            styles.turnBanner,
            {
              backgroundColor: isAiTurn ? colors.surfaceAlt : colors.surface,
              borderColor: isAiTurn ? colors.border : colors.accent,
            },
          ]}
        >
          <Text
            style={[styles.turnText, { color: isAiTurn ? colors.textMuted : colors.accent }]}
            accessibilityLiveRegion="polite"
          >
            {isAiTurn ? t("vsMode.computerTurn") : t("vsMode.yourTurn")}
          </Text>
          {isAiTurn && aiGameState && aiGameState.rolls_used > 0 && (
            <Text style={[styles.rollCounterText, { color: colors.textMuted }]}>
              {t("vsMode.rollCounter", { n: aiGameState.rolls_used })}
            </Text>
          )}
        </View>
      )}

      {/* Dice — show AI dice during AI turn */}
      <DiceRow
        dice={isAiTurn && aiGameState ? aiGameState.dice : gameState.dice}
        held={isAiTurn && aiGameState ? aiGameState.held : gameState.held}
        rollsUsed={isAiTurn && aiGameState ? aiGameState.rolls_used : gameState.rolls_used}
        gameOver={gameState.game_over}
        onRoll={handleRoll}
        onToggleHold={handleToggleHold}
        rollingIndices={isAiTurn ? aiRollingIndices : rollingIndices}
        locked={isAiTurn}
      />

      {/* Scorecard — VS mode shows unified 3-column head-to-head; solo shows player's only */}
      {aiDifficulty && difficultyChosen && aiGameState ? (
        <View style={styles.scorecardContainer}>
          <VsScorecard
            key={gameKey}
            playerScores={gameState.scores}
            playerPossibleScores={possibleScores}
            playerRollsUsed={gameState.rolls_used}
            playerGameOver={gameState.game_over}
            playerUpperBonus={gameState.upper_bonus}
            playerYachtBonusTotal={gameState.yacht_bonus_total}
            playerTotalScore={gameState.total_score}
            cpuScores={aiGameState.scores}
            cpuUpperBonus={aiGameState.upper_bonus}
            cpuYachtBonusTotal={aiGameState.yacht_bonus_total}
            cpuTotalScore={aiGameState.total_score}
            isAiTurn={isAiTurn}
            onScore={handleScore}
          />
        </View>
      ) : (
        <View style={styles.scorecardContainer}>{renderScorecard("player")}</View>
      )}

      <YachtCelebrationAnimation
        visible={showYachtCelebration}
        onDismiss={() => setShowYachtCelebration(false)}
      />

      <YachtCelebrationAnimation
        variant="joker"
        visible={showJokerCelebration}
        onDismiss={() => setShowJokerCelebration(false)}
      />

      <GameResultModal
        visible={gameReallyOver}
        outcome={resultOutcome}
        winnerName={vsResult === "lose" ? tResult("name.computer") : undefined}
        eyebrow={
          aiDifficulty
            ? `${t("game.title")} · ${t("vsMode.vsComputer")} · ${t(`difficulty.${aiDifficulty}`)}`
            : t("game.title")
        }
        subtitle={resultSubtitle}
        hero={
          aiDifficulty && aiGameState
            ? {
                kind: "versus",
                you: gameState.total_score,
                opponent: aiGameState.total_score,
                opponentLabel: t("vsMode.cpu"),
              }
            : { kind: "score", label: tResult("stat.score"), value: gameState.total_score }
        }
        stats={[
          { label: tResult("stat.upper"), value: gameState.upper_subtotal },
          { label: tResult("stat.lower"), value: lowerTotal },
          { label: tResult("stat.bonus"), value: bonusTotal > 0 ? `+${bonusTotal}` : "—" },
        ]}
        detail={
          <YachtFinalScorecard
            player={{
              scores: gameState.scores,
              upperBonus: gameState.upper_bonus,
              yachtBonusTotal: gameState.yacht_bonus_total,
              totalScore: gameState.total_score,
            }}
            opponent={
              aiDifficulty && aiGameState
                ? {
                    scores: aiGameState.scores,
                    upperBonus: aiGameState.upper_bonus,
                    yachtBonusTotal: aiGameState.yacht_bonus_total,
                    totalScore: aiGameState.total_score,
                  }
                : undefined
            }
          />
        }
        onPlayAgain={() => void playAgain()}
        secondaryAction={
          aiDifficulty
            ? {
                label: tResult("action.changeDifficulty"),
                onPress: () => void startNewGame(),
              }
            : undefined
        }
        submission={toSubmission(leaderboard)}
        onViewLeaderboard={openLeaderboard}
        onHome={() => navigation.popToTop()}
        testID="yacht-result"
      />

      <NewGameConfirmModal
        visible={confirmNewGameVisible}
        onConfirm={handleConfirmNewGame}
        onCancel={() => setConfirmNewGameVisible(false)}
      />

      {/* Pre-game mode selector (shown once for each fresh game) */}
      {!difficultyChosen && (
        <ModalCard
          visible
          onRequestClose={handleChooseSolo}
          title={t("vsMode.title")}
          accentTop
          testID="yacht-mode-card"
        >
          <View style={styles.modeContent}>
            <ModeButton
              testID="yacht-mode-solo"
              label={t("vsMode.solo")}
              selected={modePicker.mode === "solo"}
              onPress={handleChooseSolo}
            />

            <View style={[styles.modeDivider, { backgroundColor: colors.border }]} />

            <Text style={[styles.modeSubtitle, { color: colors.textMuted }]}>
              {t("vsMode.vsComputer")}
            </Text>

            <AiDifficultySelector
              value={modePicker.difficulty}
              onChange={modePicker.setDifficulty}
            />

            <ModeButton
              label={t("vsMode.vsComputer")}
              selected={modePicker.mode === "vs"}
              onPress={handleChooseVs}
            />
          </View>
        </ModalCard>
      )}

      <YachtDevPanel
        enabled={__DEV__}
        open={devOpen}
        onOpen={() => setDevOpen(true)}
        onClose={() => setDevOpen(false)}
        onApply={(dice) => {
          devDiceOverrideRef.current = dice;
        }}
      />
    </GameShell>
  );
}

const styles = StyleSheet.create({
  actionRow: {
    flexDirection: "row",
    justifyContent: "flex-end",
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  roundPill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    borderWidth: 1,
  },
  roundPillText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
  },
  scorecardContainer: {
    flex: 1,
    minHeight: 0,
    marginHorizontal: 12,
    marginBottom: 12,
  },
  rollCounterText: {
    fontSize: 11,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  // VS mode styles
  turnBanner: {
    marginHorizontal: 12,
    marginBottom: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 8,
    borderWidth: 1,
    alignItems: "center",
  },
  turnText: {
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  // Pre-game mode selector modal
  // Stretch the mode buttons full width inside the centered card.
  modeContent: {
    alignSelf: "stretch",
    gap: 12,
    // With ModalCard's 10pt title margin, keeps the old 16pt title gap.
    marginTop: 6,
  },
  modeSubtitle: {
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
    textTransform: "uppercase",
    textAlign: "center",
  },
  modeDivider: {
    height: 1,
    marginVertical: 4,
  },
});
