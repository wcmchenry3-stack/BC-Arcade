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
 *      computer, finished game id); cleared on a new game. The lobby loads
 *      the save and passes it through the route, so this screen has no mount
 *      load and doesn't use `usePersistedGameState` (GAMEPLAY_STANDARDS §8).
 *   5. Instrumentation (#368 / #549, #3282): `useGameRecorder("yacht")` (useGameSync
 *      plus the shared recorder). Each turn of both players is one
 *      `turn_completed` event, recorded when it is scored (docs/games/yacht.md,
 *      "Replay recording"); nothing is recorded per roll. Solo completes
 *      on the last score; VS completes with the result once the computer has
 *      finished too, or records the finished game on unmount / background
 *      while it is still playing (#2505).
 *   6. Result + leaderboard (#2630 / #2633): the shared GameResultModal,
 *      ranked by the finished game's session id.
 *   7. Motion (#3749, every time in `game/yacht/motion.ts`): your roll's
 *      tumble locks Roll, the dice, the score rows and Hint until the dice
 *      land; the card waits for the end beat (`useYachtEndBeat`), which waits
 *      for a YACHT! / JOKER! celebration. Reduce Motion is read live.
 */

import React, { useState, useEffect, useCallback, useRef } from "react";
import { AppState, View, Text, StyleSheet } from "react-native";
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
  YachtEngineError,
} from "../game/yacht/engine";
import { isAiTurnPending } from "../game/yacht/vsTurn";
import { saveGame, clearGame } from "../game/yacht/storage";
import { useYachtCpuOpponent } from "../game/yacht/useYachtCpuOpponent";
import { useYachtModePicker } from "../game/yacht/useYachtModePicker";
import { isPremiumLevel } from "../entitlements/premiumLevels";
import { useYachtScorecard } from "../game/yacht/ScorecardContext";
import { useGameRecorder } from "../game/_shared/useGameRecorder";
import {
  createTurnLog,
  emitTurn,
  reportRecordingError,
  startedData,
  type TurnData,
} from "../game/yacht/replay";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useScoreSound } from "../game/yacht/useScoreSound";
import { useSound } from "../game/_shared/useSound";
import { useSoundVariants } from "../game/_shared/useSoundVariants";
import {
  YACHT_DICE_ROLL,
  YACHT_DIE_HOLD,
  YACHT_DIE_RELEASE,
  YACHT_SOUNDS,
} from "../game/yacht/sounds";
import * as Sentry from "@sentry/react-native";
import DiceRow from "../components/DiceRow";
import ScoreTable from "../components/yacht/ScoreTable";
import GameActionBar from "../components/shared/GameActionBar";
import { useYachtHint } from "../components/yacht/useYachtHint";
import { soloSubtitle } from "../game/yacht/scoreSummary";
import { useLastScored } from "../game/yacht/useLastScored";
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
import { isAwayStatus } from "../hooks/usePauseWhileAway";
import { useYachtMotion } from "../components/yacht/useYachtMotion";

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

/** Width (pt) of one button in the action bar beside Roll. */
const ACTION_W = 68;
/** The action bar's height (pt): the Roll button's. */
const ACTION_BAR_H = 56;

export default function GameScreen({ navigation, route }: Props) {
  const { t } = useTranslation(["yacht", "common"]);
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const [gameState, setGameState] = useState<GameState>(route.params.initialState);
  const [possibleScores, setPossibleScores] = useState<Record<string, number>>({});
  const [gameKey, setGameKey] = useState(0);
  const [confirmNewGameVisible, setConfirmNewGameVisible] = useState(false);
  const [showYachtCelebration, setShowYachtCelebration] = useState(false);
  const [showJokerCelebration, setShowJokerCelebration] = useState(false);
  const [devOpen, setDevOpen] = useState(false);
  // Your roll's tumble and its input lock, the end beat the card waits for, the solo best (#3749).
  const motion = useYachtMotion();
  const { reduceMotion, rollingIndices, startTumble, isLocked, reset: resetMotion } = motion;
  // The player's turn as it is played (memory only); the computer's lives in its hook.
  const turnLogRef = useRef(createTurnLog());
  // Set below, once the recorder exists: the computer's finished turn goes to it.
  const onCpuTurnRef = useRef<(turn: TurnData) => void>(() => undefined);
  const onCpuTurn = useCallback((turn: TurnData) => onCpuTurnRef.current(turn), []);
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

  // Game event instrumentation (#368 / #549, #3282). Called before the
  // computer's hook so its `isRecording` is the recorder's real one when a
  // resumed computer turn starts on mount.
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
    resetPlayWindow: syncResetPlayWindow,
    beginUnit,
    record: recordEvent,
    closeUnit,
    flush: flushRecorder,
    isRecording,
  } = useGameRecorder("yacht");

  // Keep a ref in sync for callbacks.
  const gameStateRef = useRef(gameState);
  useEffect(() => {
    gameStateRef.current = gameState;
  }, [gameState]);

  // The computer's scorecard and turn loop. A restored game may have been
  // killed mid-AI-turn: resume it (#2203). If you had finished, its last turn
  // is scored at once and the card shows (#3749).
  const {
    state: aiGameState,
    setState: setAiGameState,
    stateRef: aiGameStateRef,
    difficultyRef: aiDifficultyRef,
    isTurn: isAiTurn,
    rollingIndices: aiRollingIndices,
    tumbleSpeed: aiTumbleSpeed,
    startTurn: startAiTurn,
    endTurn: endAiTurn,
    onAppBackground: onCpuAppBackground,
  } = useYachtCpuOpponent({
    difficulty: aiDifficulty,
    // With the recorder off nothing is built for the replay (no turn, no EVs):
    // `recording` is the recorder's own per-session decision.
    onTurn: onCpuTurn,
    // Its last score in vs ends the game: the end beat starts in the same batch (no flash of the
    // card). A game reopened on that last turn has no beat (owner, #3749).
    onScored: (cpu, { restored }) => motion.cpuScored(gameStateRef.current, cpu, restored),
    recording: isRecording,
    reduceMotion,
    initialState: route.params.aiState ?? null,
    resumeTurn:
      !!route.params.aiDifficulty &&
      !!route.params.aiState &&
      isAiTurnPending(route.params.initialState, route.params.aiState),
    resumeInstantly: route.params.initialState.game_over,
  });
  // The row the computer scored last: highlighted until you roll (#3748).
  const { lastScored: cpuLastScored, clear: clearCpuLastScored } = useLastScored(
    aiGameState?.scores
  );

  // The Hint is solo only: a game against the computer is not made easier. It is off while the
  // dice roll, on the computer's turn and once the game is over (#3748).
  const hintAvailable = !aiDifficulty;
  const hintDisabled = isAiTurn || gameState.game_over || rollingIndices.length > 0;
  const {
    onHint,
    clearHint,
    active: activeHint,
    message: hintMessage,
  } = useYachtHint({ available: hintAvailable, gameState, disabled: hintDisabled });

  // A turn is one recorder unit holding one event (replay.ts): one storage
  // write, saved by the recorder at an idle moment, never in a handler.
  const recordTurn = useCallback(
    (turn: TurnData, seat: 0 | 1) =>
      emitTurn(
        { beginUnit, record: recordEvent, closeUnit },
        turn,
        seat,
        // a vs game is one with a computer; the human's turn is recorded while it exists
        aiDifficultyRef.current !== null
      ),
    [beginUnit, recordEvent, closeUnit, aiDifficultyRef]
  );
  useEffect(() => {
    onCpuTurnRef.current = (turn) => recordTurn(turn, 1);
  }, [recordTurn]);

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
  const { play: playDiceRoll } = useSoundVariants(YACHT_DICE_ROLL, YACHT_SOUNDS);
  const { play: playDieHold } = useSoundVariants(YACHT_DIE_HOLD, YACHT_SOUNDS);
  const { play: playDieRelease } = useSoundVariants(YACHT_DIE_RELEASE, YACHT_SOUNDS);
  const { play: playYacht } = useSound("yacht.yacht", YACHT_SOUNDS);
  const { play: playJoker } = useSound("yacht.joker", YACHT_SOUNDS);
  // The scoring ladder (#3578): one sound per score, yours and the computer's "rival" set.
  const { play: playScoreCommit } = useSound("yacht.scoreCommit", YACHT_SOUNDS);
  const { play: playScoreZero } = useSound("yacht.scoreZero", YACHT_SOUNDS);
  const { play: playSmallStraight } = useSound("yacht.smallStraight", YACHT_SOUNDS);
  const { play: playLargeStraight } = useSound("yacht.largeStraight", YACHT_SOUNDS);
  const { play: playFullHouse } = useSound("yacht.fullHouse", YACHT_SOUNDS);
  const { play: playUpperBonus } = useSound("yacht.upperBonus", YACHT_SOUNDS);
  // The computer's players load only in a VS game: an empty key creates no player, and picking
  // the mode later loads them (useSound re-creates its player when the key changes).
  const cpu = (key: string): string => (aiDifficulty ? key : "");
  const { play: playCpuScoreCommit } = useSound(cpu("yacht.cpuScoreCommit"), YACHT_SOUNDS);
  const { play: playCpuScoreZero } = useSound(cpu("yacht.cpuScoreZero"), YACHT_SOUNDS);
  const { play: playCpuSmallStraight } = useSound(cpu("yacht.cpuSmallStraight"), YACHT_SOUNDS);
  const { play: playCpuLargeStraight } = useSound(cpu("yacht.cpuLargeStraight"), YACHT_SOUNDS);
  const { play: playCpuFullHouse } = useSound(cpu("yacht.cpuFullHouse"), YACHT_SOUNDS);
  const { play: playCpuUpperBonus } = useSound(cpu("yacht.cpuUpperBonus"), YACHT_SOUNDS);
  const { play: playCpuYacht } = useSound(cpu("yacht.cpuYacht"), YACHT_SOUNDS);
  const { play: playCpuJoker } = useSound(cpu("yacht.cpuJoker"), YACHT_SOUNDS);

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
    syncStart(
      startedData(route.params.aiDifficulty ?? null),
      sessionMetadata(route.params.aiDifficulty ?? null)
    );
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

  // The computer's rolls play the same dice roll as the player's (#3578). Keyed on its tumble
  // starting (a new non-empty rollingIndices array per roll), not on its engine events, so a
  // computer turn restored from a save doesn't replay a roll and its scoring stays silent.
  // Once per roll: a new `playDiceRoll` identity on a re-render must not replay it.
  const lastAiRollRef = useRef(aiRollingIndices);
  useEffect(() => {
    if (aiRollingIndices === lastAiRollRef.current) return;
    lastAiRollRef.current = aiRollingIndices;
    if (aiRollingIndices.length > 0) playDiceRoll();
  }, [aiRollingIndices, playDiceRoll]);

  // A score plays one sound: its top milestone, else the commit (or the duller zero). Yours
  // here (a yacht or joker plays its fanfare in the handlers below); the computer's below.
  useScoreSound(gameState.events, {
    upperBonus: playUpperBonus,
    largeStraight: playLargeStraight,
    fullHouse: playFullHouse,
    smallStraight: playSmallStraight,
    commit: playScoreCommit,
    zero: playScoreZero,
  });
  // The computer's: the opposite tone, short, its yacht and joker included (#3578).
  useScoreSound(aiGameState?.events, {
    yacht: playCpuYacht,
    joker: playCpuJoker,
    upperBonus: playCpuUpperBonus,
    largeStraight: playCpuLargeStraight,
    fullHouse: playCpuFullHouse,
    smallStraight: playCpuSmallStraight,
    commit: playCpuScoreCommit,
    zero: playCpuScoreZero,
  });

  // Process game events — play sounds, trigger animations, then clear
  useGameEvents(
    gameState.events,
    {
      // The tumble itself starts in handleRoll, with the roll (#3749).
      diceRoll: () => playDiceRoll(),
      dieHold: () => playDieHold(),
      dieRelease: () => playDieRelease(),
      yacht: () => {
        playYacht();
        motion.celebrationStarted();
        setShowYachtCelebration(true);
      },
      joker: () => {
        playJoker();
        motion.celebrationStarted();
        setShowJokerCelebration(true);
      },
    },
    () => setGameState((prev) => (prev === null ? prev : { ...prev, events: undefined }))
  );

  // Single mount-time AppState listener — clears animation state on background.
  // The async AI turn keeps running; no cancellation or replay needed.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (isAwayStatus(next)) {
        onCpuAppBackground();
        // Save the recorded turns now: an idle save may never run before the
        // OS kills the process (#3282). Synchronous, memory to queue.
        flushRecorder();
        // The process may be killed from here (#2505). "inactive" too: iOS's
        // app switcher only makes the app inactive, and a swipe-away there
        // kills it without it ever reaching "background".
        completeIfCpuStillPlayingRef.current();
      }
    });
    return () => sub.remove();
  }, [onCpuAppBackground, flushRecorder]);

  function handleRoll() {
    if (isAiTurn || isLocked()) return;
    setError(null);
    clearHint();
    clearCpuLastScored();
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
      // The rolled dice tumble from this render on, and input waits for them to land.
      startTumble(next.events);
      // Memory only: the turn is recorded once, when it is scored (replay.ts).
      if (isRecording()) turnLogRef.current.roll(next);
    } catch (e: unknown) {
      setError(yachtErrorMessage(e));
    }
  }

  function handleToggleHold(index: number) {
    if (isAiTurn || isLocked()) return;
    clearHint();
    const next = engineToggleHold(gameState, index);
    if (next !== gameState) {
      setGameState(next);
      if (isRecording()) {
        turnLogRef.current.hold(next.rolls_used, index, next.held[index] === true);
      }
    }
  }

  function handleScore(category: string) {
    if (isAiTurn || isLocked()) return;
    setError(null);
    clearHint();
    try {
      const prev = gameState;
      const alternatives = enginePossibleScores(prev);
      const next = engineScore(prev, category as Category);
      setGameState(next);
      // The turn is complete: one unit, one event (the recorder saves it at idle).
      // Its own try: a failure here must not stop the CPU's turn or the completion below.
      if (isRecording()) {
        try {
          recordTurn(
            turnLogRef.current.finish({
              prev,
              next,
              category: category as Category,
              alternatives,
            }),
            0
          );
        } catch (recordError: unknown) {
          turnLogRef.current.reset();
          reportRecordingError(recordError, "humanTurn");
        }
      }
      if (next.game_over) {
        if (aiDifficultyRef.current && aiGameStateRef.current) {
          // VS mode: the CPU takes its last turn first; the session completes
          // with the result once it has (see the effect on gameReallyOver).
          // The card's rank lookup needs this game's id (#2630), and the
          // session isn't closed yet for complete() to hand it back — read
          // the still-open id now, before the CPU (or an unmount/background,
          // via completeIfCpuStillPlayingRef) closes it.
          setFinishedGameId(syncGetGameId());
          // Its last turn plays at 2x, still shown; the end beat starts with its last score.
          startAiTurn({ lastTurn: true });
        } else {
          // Solo: the card waits for the end beat (after the celebration, if this score is a
          // Yacht or a Joker), started with this score's setState. A new best is a win.
          motion.soloEnded(next);
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
      setError(yachtErrorMessage(e));
    }
  }

  const [error, setError] = useState<string | null>(null);

  // Engine rule violations carry a code; show the translated text, and a
  // generic translated fallback for anything unexpected (#2221).
  function yachtErrorMessage(e: unknown): string {
    if (e instanceof YachtEngineError) return t(`yacht:error.${e.code}`);
    return t("yacht:error.generic");
  }

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
      // The next game starts with no turn in progress.
      turnLogRef.current.reset();
      // The next game gets its own leaderboard line.
      resetRank();
      await clearGame();
      setFinishedGameId(null);
      clearHint();
      clearCpuLastScored();
      // No beat or tumble carried into the next game.
      resetMotion();
      setGameState(newGame());
      endAiTurn();
      setGameKey((k) => k + 1);
      setError(null);
      if (keep) {
        // Play Again: same mode and difficulty, straight into a new game.
        setAiDifficulty(keptDifficulty);
        setAiGameState(keptDifficulty ? newGame() : null);
        setDifficultyChosen(true);
        syncStart(startedData(keptDifficulty), sessionMetadata(keptDifficulty));
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
      clearHint,
      clearCpuLastScored,
      resetMotion,
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
    syncStart(startedData(difficulty), sessionMetadata(difficulty));
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
          : soloSubtitleText();
  const bonusTotal = gameState.upper_bonus + gameState.yacht_bonus_total;
  const lowerTotal = gameState.total_score - gameState.upper_subtotal - bonusTotal;

  /** A finished solo game's line under the title: the rarest feat first (soloSubtitle). */
  function soloSubtitleText(): string | undefined {
    const s = soloSubtitle(gameState);
    if (s === null) return undefined;
    switch (s.kind) {
      case "yachtBonus":
        return t("gameOver.yachtBonus", { count: s.count, total: s.total });
      case "yachtScored":
        return t("gameOver.yachtScored", { score: s.score });
      case "upperBonus":
        return t("gameOver.upperBonus");
    }
  }

  const actionButtons = [
    ...(hintAvailable
      ? [
          {
            key: "hint",
            icon: "lightbulb" as const,
            label: t("action.hint"),
            accessibilityLabel: t("action.hintLabel"),
            color: colors.outcomeWin,
            disabled: hintDisabled,
            // Disabled (and inert) while your dice tumble (#3749): `hintDisabled` above.
            onPress: onHint,
            testID: "yacht-hint-button",
          },
        ]
      : []),
    {
      key: "newGame",
      icon: "refresh" as const,
      label: t("common:newGame.button"),
      accessibilityLabel: t("common:newGame.button"),
      color: colors.accentText,
      onPress: handleNewGamePress,
      testID: "yacht-new-game-button",
    },
  ];

  const roundPill = (
    <View
      style={[styles.roundPill, { backgroundColor: colors.surfaceAlt, borderColor: colors.accent }]}
    >
      <Text style={[styles.roundPillText, { color: colors.accentText }]}>
        {t("round.header", {
          // The round of whoever is playing: the player's counter is already
          // ahead while the computer plays its turn of the same round (#3491).
          round: Math.min(isAiTurn && aiGameState ? aiGameState.round : gameState.round, 13),
        })}
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
        paddingBottom: 16,
      }}
    >
      {/* The scorecard: one table for solo and VS, all 13 rows (ScoreTable) */}
      <View style={styles.scorecardContainer}>
        <ScoreTable
          key={gameKey}
          playerScores={gameState.scores}
          playerPossibleScores={possibleScores}
          playerRollsUsed={gameState.rolls_used}
          playerGameOver={gameState.game_over}
          playerTotalScore={gameState.total_score}
          playerYachtBonusTotal={gameState.yacht_bonus_total}
          cpu={
            aiDifficulty && difficultyChosen && aiGameState
              ? {
                  scores: aiGameState.scores,
                  totalScore: aiGameState.total_score,
                  yachtBonusTotal: aiGameState.yacht_bonus_total,
                }
              : null
          }
          isAiTurn={isAiTurn}
          onScore={handleScore}
          hintCategory={activeHint?.kind === "score" ? activeHint.category : null}
          cpuLastScored={cpuLastScored}
          inputLocked={rollingIndices.length > 0}
        />
      </View>

      {/* The thumb tray: turn hint, the dice (the computer's on its turn), Roll and the action bar */}
      <DiceRow
        dice={isAiTurn && aiGameState ? aiGameState.dice : gameState.dice}
        held={isAiTurn && aiGameState ? aiGameState.held : gameState.held}
        rollsUsed={isAiTurn && aiGameState ? aiGameState.rolls_used : gameState.rolls_used}
        gameOver={gameState.game_over}
        onRoll={handleRoll}
        onToggleHold={handleToggleHold}
        rollingIndices={isAiTurn ? aiRollingIndices : rollingIndices}
        tumbleSpeed={isAiTurn ? aiTumbleSpeed : 1}
        inputLocked={!isAiTurn && rollingIndices.length > 0}
        locked={isAiTurn}
        computerRolls={aiGameState?.rolls_used ?? 0}
        turnLabel={aiDifficulty && difficultyChosen ? t("vsMode.yourTurn") : null}
        hintMessage={hintMessage}
        hintHold={activeHint?.kind === "hold" ? activeHint.held : null}
        actions={
          <View style={{ width: ACTION_W * actionButtons.length }}>
            <GameActionBar
              testID="yacht-action-bar"
              height={ACTION_BAR_H}
              bordered={false}
              actions={actionButtons}
            />
          </View>
        }
      />

      <YachtCelebrationAnimation
        visible={showYachtCelebration}
        onDismiss={() => {
          setShowYachtCelebration(false);
          motion.celebrationEnded();
        }}
      />

      <YachtCelebrationAnimation
        variant="joker"
        visible={showJokerCelebration}
        onDismiss={() => {
          setShowJokerCelebration(false);
          motion.celebrationEnded();
        }}
      />

      {/* The card waits for the end beat (#3749); a game reopened on the computer's last turn has none. */}
      <GameResultModal
        visible={gameReallyOver && !motion.holding}
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
        // Solo: the player's Upper / Lower / Bonus. Against the computer these would be the
        // player's alone and unlabelled (audit bug 13): the card's scorecard shows both players'.
        stats={
          aiDifficulty
            ? undefined
            : [
                { label: tResult("stat.upper"), value: gameState.upper_subtotal },
                { label: tResult("stat.lower"), value: lowerTotal },
                { label: tResult("stat.bonus"), value: bonusTotal > 0 ? `+${bonusTotal}` : "—" },
              ]
        }
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
              testID="yacht-mode-vs"
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
  // The scorecard takes the height the tray leaves; it scrolls only below the height 13 rows need.
  scorecardContainer: {
    flex: 1,
    minHeight: 0,
    marginTop: 4,
    marginBottom: 10,
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
