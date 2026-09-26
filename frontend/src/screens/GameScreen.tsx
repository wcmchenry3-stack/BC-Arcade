import React, { useState, useEffect, useCallback, useRef } from "react";
import { AppState, Modal, ScrollView, View, Text, StyleSheet, Pressable } from "react-native";
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
import { holdStrategy, scoreStrategy } from "../game/yacht/ai";
import { preloadOracleTable } from "../game/yacht/oracle/oracle";
import { finishTurnFallback, isAiTurnPending } from "../game/yacht/vsTurn";
import { saveGame, clearGame, saveLastMode, loadLastMode } from "../game/yacht/storage";
import { isPremiumLevel } from "../entitlements/premiumLevels";
import { useYachtScorecard } from "../game/yacht/ScorecardContext";
import { useGameSync } from "../game/_shared/useGameSync";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { sessionBoardAdapter } from "../game/_shared/sessionBoardAdapter";
import { useSound } from "../game/_shared/useSound";
import { YACHT_SOUNDS } from "../game/yacht/sounds";
import * as Sentry from "@sentry/react-native";
import DiceRow from "../components/DiceRow";
import Scorecard from "../components/Scorecard";
import VsScorecard from "../components/yacht/VsScorecard";
import GameResultModal, { type GameOutcome } from "../components/shared/GameResultModal";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import YachtFinalScorecard from "../components/yacht/YachtFinalScorecard";
import AiDifficultySelector from "../components/yacht/AiDifficultySelector";
import { YachtCelebrationAnimation } from "../components/yacht/YachtCelebrationAnimation";
import NewGameConfirmModal from "../components/shared/NewGameConfirmModal";
import { ModalCard } from "../components/shared/ModalCard";
import { useTheme } from "../theme/ThemeContext";
import {
  DEV_ACCENT,
  DEV_ACCENT_DIM,
  DEV_ACCENT_BORDER,
  DEV_OVERLAY_BG,
  DEV_SURFACE_SUBTLE,
  DEV_SURFACE_DIM,
} from "../theme/theme.constants";
import { GameShell } from "../components/shared/GameShell";
import { PillButton } from "../components/shared/PillButton";

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "Game">;
  route: RouteProp<HomeStackParamList, "Game">;
};

/** Solo and vs games rank on Yacht's one session board (#2630). */
const yachtBoard = sessionBoardAdapter("yacht");

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
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [devDice, setDevDice] = useState<[number, number, number, number, number]>([3, 3, 3, 3, 3]);
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
  const [pendingMode, setPendingMode] = useState<"solo" | "vs">("solo");
  const [pendingDiff, setPendingDiff] = useState<AiDifficulty>("medium");
  // The difficulty the last VS game started at, not one merely tapped in the picker (#1129).
  const lastVsDiffRef = useRef<AiDifficulty>("medium");
  const [aiDifficulty, setAiDifficulty] = useState<AiDifficulty | null>(
    route.params.aiDifficulty ?? null
  );
  const [aiGameState, setAiGameState] = useState<GameState | null>(route.params.aiState ?? null);
  // A restored game may have been killed mid-AI-turn: resume it (#2203).
  const [isAiTurn, setIsAiTurn] = useState(
    () =>
      !!route.params.aiDifficulty &&
      !!route.params.aiState &&
      isAiTurnPending(route.params.initialState, route.params.aiState)
  );
  const [aiRollingIndices, setAiRollingIndices] = useState<readonly number[]>([]);
  const isAiTurnRef = useRef(isAiTurn);
  const aiTurnCancelledRef = useRef(false);

  // Keep refs in sync for use inside async AI turn loop and callbacks.
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  const aiDifficultyRef = useRef(aiDifficulty);
  useEffect(() => {
    aiDifficultyRef.current = aiDifficulty;
    // Decode the AI's optimal-play table before its first turn (#2246). If
    // this fails, the AI decodes it on demand instead, so just record it.
    if (aiDifficulty) preloadOracleTable().catch((e) => Sentry.captureException(e));
  }, [aiDifficulty]);

  const aiGameStateRef = useRef(aiGameState);
  useEffect(() => {
    aiGameStateRef.current = aiGameState;
  }, [aiGameState]);

  useEffect(() => {
    isAiTurnRef.current = isAiTurn;
  }, [isAiTurn]);

  // Seed the mode selector with whatever the user picked last.
  useEffect(() => {
    let cancelled = false;
    loadLastMode().then((pref) => {
      if (!cancelled && pref) {
        setPendingMode(pref.mode);
        setPendingDiff(pref.difficulty);
        lastVsDiffRef.current = pref.difficulty;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
    resetPlayWindow: syncResetPlayWindow,
  } = useGameSync("yacht");

  // Result card leaderboard line (#2630): the finished session row ranks on
  // its own; the card only asks where it landed.
  const leaderboard = useLeaderboardSubmit(yachtBoard);
  const { submit: submitRank, reset: resetRank } = leaderboard;
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
    const payload: Record<string, unknown> = {
      final_score: s.total_score,
      upper_bonus: s.upper_bonus,
      yacht_bonus_total: s.yacht_bonus_total,
      outcome,
    };
    // #2505: vs-mode games report who won once the CPU has finished.
    if (opponent?.game_over && outcome === "completed") {
      const vsResult = vsOutcome(s, opponent);
      payload.opponent_score = opponent.total_score;
      payload.vs_result = vsResult;
      // #2517: the row records who won (a tie is `push`), not just "completed".
      payload.outcome = recordedOutcome(vsResult);
    }
    return payload;
  }

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

  // Sync snapshot to shared scorecard context (read by ScoreboardScreen).
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
      if (next === "background" || next === "inactive") {
        if (isAiTurnRef.current) setAiRollingIndices([]);
        // The process may be killed from here (#2505). "inactive" too: iOS's
        // app switcher only makes the app inactive, and a swipe-away there
        // kills it without it ever reaching "background".
        completeIfCpuStillPlayingRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  // AI turn loop: fires whenever isAiTurn becomes true.
  useEffect(() => {
    if (!isAiTurn || !aiDifficultyRef.current || !aiGameStateRef.current) return;

    aiTurnCancelledRef.current = false;

    // The AI's state as of its last completed step, so a failure part-way
    // through can finish the turn from there.
    let s = aiGameStateRef.current!;

    async function runAiTurn() {
      const diff = aiDifficultyRef.current!;

      if (s.rolls_used === 0) {
        // Initial roll (all dice free) — compute result first so animation plays over final values.
        s = engineRoll(s, [false, false, false, false, false]);
        setAiGameState(s);
        setAiRollingIndices([0, 1, 2, 3, 4]);
        await delay(1000);
        if (aiTurnCancelledRef.current) return;
        setAiRollingIndices([]);
      }
      // Resuming a turn interrupted after it had rolled (app killed, or the
      // effect re-ran) keeps the dice it already has rather than re-rolling
      // them — and with all three rolls used, re-rolling would throw (#2203).
      // Settle pause: let the player read the dice values
      await delay(800);
      if (aiTurnCancelledRef.current) return;

      // Up to two re-rolls using hold strategy
      while (s.rolls_used < 3) {
        const holds = holdStrategy(s, diff);
        if (holds.every((h) => h)) break; // all dice held — go straight to scoring
        // Show hold decision on current values so the player sees the AI's choice
        setAiGameState({ ...s, held: holds });
        await delay(800);
        if (aiTurnCancelledRef.current) return;
        const rolledIdxs = holds.reduce<number[]>((acc, h, i) => {
          if (!h) acc.push(i);
          return acc;
        }, []);
        // Compute result before starting animation
        s = engineRoll(s, holds);
        setAiGameState(s);
        setAiRollingIndices(rolledIdxs);
        await delay(1000);
        if (aiTurnCancelledRef.current) return;
        setAiRollingIndices([]);
        await delay(800);
        if (aiTurnCancelledRef.current) return;
      }

      // Beat before the AI locks in its category
      await delay(1000);
      if (aiTurnCancelledRef.current) return;
      const cat = scoreStrategy(s, diff);
      s = engineScore(s, cat);
      setAiGameState(s);
      setIsAiTurn(false);
    }

    // If the turn fails, report it and finish the computer's turn with a
    // plain fallback before handing back control. Just unlocking would leave
    // the computer a round behind for good, so its game could never end and
    // the VS result screen would never show (#2203).
    runAiTurn().catch((e: unknown) => {
      Sentry.captureException(e, { tags: { subsystem: "yacht.ai", op: "runAiTurn" } });
      if (aiTurnCancelledRef.current) return;
      setAiRollingIndices([]);
      try {
        setAiGameState(finishTurnFallback(s));
      } catch (fallbackError: unknown) {
        // Last resort: unlock the board rather than freeze it.
        Sentry.captureException(fallbackError, {
          tags: { subsystem: "yacht.ai", op: "finishTurnFallback" },
        });
      }
      setIsAiTurn(false);
    });
    return () => {
      aiTurnCancelledRef.current = true;
    };
  }, [isAiTurn]);

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
        // The card's rank lookup needs this game's id (#2630).
        setFinishedGameId(syncGetGameId());
        if (aiDifficultyRef.current && aiGameStateRef.current) {
          // VS mode: the CPU takes its last turn first; the session completes
          // with the result once it has (see the effect on gameReallyOver).
          setIsAiTurn(true);
        } else {
          const payload = endedPayload(next, "completed");
          syncComplete(
            { finalScore: next.total_score, outcome: "completed", result: payload },
            payload
          );
        }
      } else if (aiDifficultyRef.current && aiGameStateRef.current) {
        setIsAiTurn(true);
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
      setIsAiTurn(false);
      setGameKey((k) => k + 1);
      setError(null);
      if (keep) {
        // Play Again: same mode and difficulty, straight into a new game.
        setAiDifficulty(keptDifficulty);
        setAiGameState(keptDifficulty ? newGame() : null);
        setDifficultyChosen(true);
        syncStart(undefined, sessionMetadata(keptDifficulty));
      } else {
        const pref = await loadLastMode();
        setPendingMode(pref?.mode ?? "solo");
        setPendingDiff(pref?.difficulty ?? "medium");
        lastVsDiffRef.current = pref?.difficulty ?? "medium";
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
    [syncComplete, syncStart, resetRank]
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
    // Keep the last VS difficulty played, so the next VS game still opens on it (#1129).
    void saveLastMode("solo", lastVsDiffRef.current);
    setDifficultyChosen(true);
    startChosenGame(null);
  }

  function handleChooseVs() {
    void saveLastMode("vs", pendingDiff);
    lastVsDiffRef.current = pendingDiff;
    setAiDifficulty(pendingDiff);
    setAiGameState(newGame());
    setDifficultyChosen(true);
    startChosenGame(pendingDiff);
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
    if (gameReallyOver && finishedGameId) void submitRank({ gameId: finishedGameId });
  }, [gameReallyOver, finishedGameId, submitRank]);

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
        {t("round.header", { round: gameState.round })}
      </Text>
    </View>
  );

  return (
    <GameShell
      title={t("game.title")}
      rightSlot={roundPill}
      requireBack
      onBack={() => navigation.popToTop()}
      onNewGame={startNewGame}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "yacht" })}
      error={error}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 16),
        paddingRight: Math.max(insets.right, 16),
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
        submission={{
          status: leaderboard.status,
          rank: leaderboard.rank,
          playerName: leaderboard.playerName,
          onProvideName: leaderboard.provideName,
          onRetry: leaderboard.retry,
        }}
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
              selected={pendingMode === "solo"}
              onPress={handleChooseSolo}
            />

            <View style={[styles.modeDivider, { backgroundColor: colors.border }]} />

            <Text style={[styles.modeSubtitle, { color: colors.textMuted }]}>
              {t("vsMode.vsComputer")}
            </Text>

            <AiDifficultySelector value={pendingDiff} onChange={setPendingDiff} />

            <ModeButton
              label={t("vsMode.vsComputer")}
              selected={pendingMode === "vs"}
              onPress={handleChooseVs}
            />
          </View>
        </ModalCard>
      )}

      {__DEV__ && (
        <Pressable style={styles.devButton} onPress={() => setDevPanelOpen(true)}>
          <Text style={styles.devButtonText}>DEV</Text>
        </Pressable>
      )}

      {__DEV__ && (
        <Modal
          visible={devPanelOpen}
          transparent
          animationType="fade"
          accessibilityViewIsModal
          onRequestClose={() => setDevPanelOpen(false)}
        >
          <View style={styles.devOverlay}>
            <View style={[styles.devPanel, { backgroundColor: colors.surfaceHigh }]}>
              <ScrollView
                showsVerticalScrollIndicator={false}
                contentContainerStyle={styles.devScrollContent}
              >
                <Text style={styles.devTitle}>Yacht Dev Panel</Text>

                <Text style={[styles.devSectionHeader, { color: colors.textMuted }]}>
                  ── Dice Override ──
                </Text>
                <Text style={[styles.devHint, { color: colors.textMuted }]}>
                  Applied on next roll. Held dice are respected.
                </Text>

                <View style={styles.devDiceRow}>
                  {devDice.map((val, i) => (
                    <View key={i} style={styles.devDieCell}>
                      <Pressable
                        style={styles.devStepBtn}
                        onPress={() =>
                          setDevDice((d) => {
                            const next = [...d] as typeof d;
                            next[i] = Math.min(6, d[i]! + 1);
                            return next;
                          })
                        }
                        accessibilityLabel={`Increase die ${i + 1}`}
                      >
                        <Text style={styles.devStepText}>+</Text>
                      </Pressable>
                      <Text style={styles.devDieValue}>{val}</Text>
                      <Pressable
                        style={styles.devStepBtn}
                        onPress={() =>
                          setDevDice((d) => {
                            const next = [...d] as typeof d;
                            next[i] = Math.max(1, d[i]! - 1);
                            return next;
                          })
                        }
                        accessibilityLabel={`Decrease die ${i + 1}`}
                      >
                        <Text style={styles.devStepText}>−</Text>
                      </Pressable>
                    </View>
                  ))}
                </View>

                <Text style={[styles.devSectionHeader, { color: colors.textMuted }]}>
                  ── Presets ──
                </Text>

                {(
                  [
                    ["Yacht", [3, 3, 3, 3, 3]],
                    ["Full House", [2, 2, 2, 5, 5]],
                    ["Sm. Straight", [1, 2, 3, 4, 6]],
                    ["Lg. Straight", [1, 2, 3, 4, 5]],
                    ["All 1s", [1, 1, 1, 1, 1]],
                    ["All 6s", [6, 6, 6, 6, 6]],
                  ] as [string, [number, number, number, number, number]][]
                ).map(([label, preset]) => (
                  <Pressable
                    key={label}
                    style={styles.devPresetBtn}
                    onPress={() => setDevDice(preset)}
                  >
                    <Text style={styles.devPresetText}>
                      {label} [{preset.join(",")}]
                    </Text>
                  </Pressable>
                ))}

                <Pressable
                  style={[styles.devActionBtn, { backgroundColor: DEV_ACCENT }]}
                  onPress={() => {
                    devDiceOverrideRef.current = [...devDice];
                    setDevPanelOpen(false);
                  }}
                >
                  <Text style={styles.devActionPrimaryText}>Apply on next roll</Text>
                </Pressable>

                <Pressable
                  style={[styles.devActionBtn, { backgroundColor: DEV_SURFACE_SUBTLE }]}
                  onPress={() => setDevPanelOpen(false)}
                >
                  <Text style={[styles.devActionText, { color: colors.textMuted }]}>Close</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </GameShell>
  );
}

/** Solo / vs Computer choice in the pre-game mode picker; filled when selected. */
function ModeButton({
  label,
  selected,
  onPress,
  testID,
}: {
  readonly label: string;
  readonly selected: boolean;
  readonly onPress: () => void;
  readonly testID?: string;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={testID}
      style={
        selected
          ? [
              styles.modeBtn,
              styles.modeBtnPrimary,
              { borderColor: colors.accent, backgroundColor: colors.accent },
            ]
          : [styles.modeBtn, { borderColor: colors.border }]
      }
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
    >
      <Text style={[styles.modeBtnText, { color: selected ? colors.textOnAccent : colors.text }]}>
        {label}
      </Text>
    </Pressable>
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
  modeBtn: {
    borderWidth: 1,
    borderRadius: 999,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 48,
  },
  modeBtnPrimary: {
    marginTop: 4,
  },
  modeBtnText: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  modeDivider: {
    height: 1,
    marginVertical: 4,
  },
  // DEV panel styles
  devButton: {
    position: "absolute",
    bottom: 8,
    right: 8,
    backgroundColor: DEV_ACCENT_DIM,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 4,
    zIndex: 100,
  },
  devButtonText: {
    color: "#fff",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 1,
  },
  devOverlay: {
    flex: 1,
    backgroundColor: DEV_OVERLAY_BG,
    alignItems: "center",
    justifyContent: "center",
  },
  devPanel: {
    borderRadius: 12,
    padding: 24,
    width: 320,
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: DEV_ACCENT_BORDER,
  },
  devScrollContent: {
    gap: 12,
  },
  devTitle: {
    color: DEV_ACCENT,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    textTransform: "uppercase",
  },
  devSectionHeader: {
    fontSize: 10,
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 4,
  },
  devHint: {
    fontSize: 11,
    textAlign: "center",
  },
  devDiceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },
  devDieCell: {
    flex: 1,
    alignItems: "center",
    gap: 4,
  },
  devStepBtn: {
    backgroundColor: DEV_SURFACE_DIM,
    width: 32,
    height: 32,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  devStepText: {
    color: "#fff",
    fontSize: 18,
    lineHeight: 22,
  },
  devDieValue: {
    color: "#fff",
    fontSize: 20,
    fontWeight: "700",
    minWidth: 24,
    textAlign: "center",
  },
  devPresetBtn: {
    backgroundColor: DEV_SURFACE_SUBTLE,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  devPresetText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
  devActionBtn: {
    borderRadius: 8,
    paddingVertical: 10,
    alignItems: "center",
  },
  devActionPrimaryText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "700",
  },
  devActionText: {
    fontSize: 13,
  },
});
