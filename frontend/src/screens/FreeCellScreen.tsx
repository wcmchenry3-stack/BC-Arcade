/**
 * FreeCellScreen — playable FreeCell with full lifecycle wiring.
 *
 * Concerns:
 *   1. Game logic — FreeCellBoard (components/freecell) sends drags and taps to the pure
 *      engine (`applyMove`, `undoMove`, `applyHint`); deals come from the solvable seed bank.
 *   2. Auto-complete — `startAutoComplete` steps the finish with the board input-locked (#2225); only the
 *      Auto-Complete button starts it (#3566).
 *   3. Persistence — `usePersistedGameState` (#3087) restores the save on mount (or deals
 *      fresh) and saves after every change once it has loaded.
 *   4. Instrumentation (#2452) — `useGameRecorder("freecell")` (`useGameSync` plus the shared
 *      recorder), opened on the first move; a win records its move count (#2632); a restored
 *      game resumes its session (#2654). Every action (move, undo, hint, auto-complete step) is
 *      appended to an in-memory move log and recorded 25 at a time (#3289,
 *      docs/games/freecell.md, "Replay recording"); nothing is saved per action.
 *   5. Result + leaderboard (#2633) — the win is `useCompletionTransition` (#3087): once
 *      per game, a resumed won game records nothing; the shared GameResultModal; best
 *      moves via the shared personal best (#3757); ranked via `useGameLeaderboard`.
 *   6. Events and layout — `useGameEvents` plays the sounds and banners. The
 *      board sits on the shared felt (#3607) under a MOVES · TIME stat line; its geometry
 *      (`game/freecell/layout.ts`) fits the tallest legal column, so it never scrolls
 *      vertically. TIME is the game's own play clock (`game/freecell/playClock.ts`).
 *   7. Large cards (#3347) — a ⋯ menu toggle, stored on this device: cards at a fixed larger
 *      width, the board scrolling sideways (FreeCellBoard `scrollable`).
 *   8. Card motion (#3573) — `useFreeCellMotion`: the engine stays instant and the board's
 *      flight layer draws the cards each action moved; every sound is timed to its landing.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StyleSheet, Text, useWindowDimensions, View } from "react-native";
import type { LayoutChangeEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import * as Sentry from "@sentry/react-native";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { FELT_BORDER_WIDTH, FeltTable } from "../components/shared/FeltTable";
import { TABLE_STAT_LINE_HEIGHT, TableStatLine } from "../components/shared/TableStatLine";
import { PlayClockText } from "../components/shared/PlayClockText";
import { useReduceMotion } from "../components/shared/useReduceMotion";
import { useSafeBottomTabBarHeight } from "../hooks/useSafeBottomTabBarHeight";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import { useCompletionTransition } from "../game/_shared/useCompletionTransition";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { PillButton } from "../components/shared/PillButton";
import { AutoCompleteButton } from "../components/shared/AutoCompleteButton";
import FreeCellBoard from "../components/freecell/FreeCellBoard";
import { CardFlightContext } from "../components/cards/cardFlights";
import {
  useFreeCellMotion,
  useFreeCellMotionGeometry,
} from "../components/freecell/useFreeCellMotion";
import { FreeCellGameWinAnimation } from "../components/freecell/FreeCellGameWinAnimation";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import {
  dealGame,
  dealEventData,
  drawDealSeed,
  type DealPick,
  applyMove,
  undoMove,
  applyHint,
  getHintMoves,
  canAutoComplete,
  autoComplete,
  nextAutoMove,
} from "../game/freecell/engine";
import {
  hintAction,
  moveAction,
  recordedStart,
  undoAction,
  withRecorded,
  withoutRecorded,
} from "../game/freecell/replay";
import { guardRecording, savedRows, type Action } from "../game/_shared/cards/moveLog";
import { useMoveLog } from "../game/_shared/cards/useMoveLog";
import { useFlushOnBackground } from "../game/_shared/useFlushOnBackground";
import type { FreeCellState, Move } from "../game/freecell/types";
import { clearGame, loadGame, saveGame } from "../game/freecell/storage";
import { getBest, judgeResult, recordResult } from "../game/_shared/personalBest";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useGameRestored, usePersistedGameState } from "../game/_shared/usePersistedGameState";
import { useGameRecorder } from "../game/_shared/useGameRecorder";
import { useSound } from "../game/_shared/useSound";
import { useSoundVariants } from "../game/_shared/useSoundVariants";
import { FREECELL_CARD_PLACE, FREECELL_SOUNDS } from "../game/freecell/sounds";
import type { DropOffset } from "../game/_shared/drag/DragContext";
import { CardSizeContext } from "../game/_shared/CardSizeContext";
import { useLargeCards } from "../game/freecell/largeCards";
import {
  SCROLL_BAR_HEIGHT,
  SCROLL_PAD,
  freeCellBoardGeometry,
  freeCellBoardWidth,
  largeBoardOverflows,
} from "../game/freecell/layout";
import {
  TABLE_BOTTOM_BAND,
  TABLE_FELT_MARGIN_BOTTOM,
  TABLE_FELT_MARGIN_TOP,
  estimateFeltSize,
  faceUpStepFor,
} from "../game/_shared/cards/tableLayout";
import { reportTableauOffTable } from "../game/_shared/cards/offTableReport";
import { useDeck } from "../game/_shared/decks/CardDeckContext";
import {
  forSave,
  onLoad,
  pauseGame,
  resumeGame,
  withClockOf,
  withMoveClock,
} from "../game/freecell/playClock";

const AUTO_STEP_MS = 120;
/** Side gutter between the screen's edge and the felt, in dp (as Solitaire's). */
const FELT_GUTTER = 6;

export default function FreeCellScreen() {
  const { t } = useTranslation("freecell");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  // The fewest moves in a win on this device, for the "new best" badge: the shared personal
  // best (#3757), read with the saved game.
  const bestMovesRef = useRef(0);
  // The saved game (usePersistedGameState, #3087): loaded with the best on mount, then
  // saved on every change once that load has landed. Called before the win effect, so a
  // winning move is saved before the win clears it. `stateRef` is the latest state, read
  // by the new-game abandon and the unmount snapshot, neither of which can close over
  // `state`. The restore is below.
  const game = usePersistedGameState<FreeCellState>({
    load: async () => {
      const [saved, bestMoves] = await Promise.all([loadGame(), getBest("freecell")]);
      bestMovesRef.current = bestMoves;
      // None of the time the app was closed counts on the play clock (#3607). A load that
      // lands while the player is already away is paused in the restore handler below.
      return saved === null ? saved : onLoad(saved);
    },
    save: (s) => saveGame(forSave(s)),
    clear: clearGame,
  });
  const { state, setState, stateRef, loading, hasLoadedRef, clear: clearSavedGame } = game;

  // The play clock behind TIME (#3607) pauses while the player is away: another screen
  // over the game, the app in the background, or the ⋯ menu open. Leaving also lands every
  // card in flight and drops every pending sound cue and hold (#3573).
  const leaveMotionRef = useRef<() => void>(() => undefined);
  const awayRef = usePauseWhileAway(
    navigation,
    () => {
      leaveMotionRef.current();
      setState((s) => (s === null ? s : pauseGame(s)));
    },
    () => setState((s) => (s === null ? s : resumeGame(s)))
  );
  /** `next`, a move or an Auto-Complete step made on `prev`, with the play clock. */
  const clockMove = useCallback(
    (prev: FreeCellState, next: FreeCellState): FreeCellState => {
      const timed = withMoveClock(prev, next);
      // Made from a board rendered before the player left: it must not run the clock.
      return awayRef.current ? pauseGame(timed) : timed;
    },
    [awayRef]
  );

  // Large cards' fallback to fitted cards and its hysteresis (#3607): the setting it was
  // decided for, and the tallest column's length that caused the fallback (see the geometry).
  const [largeDecision, setLargeDecision] = useState<{
    largeCards: boolean;
    fallbackAt: number | null;
  }>({ largeCards: false, fallbackAt: null });

  const isMountedRef = useRef(true);
  const autoCompletingRef = useRef(false);
  const autoStepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoCompleting, setAutoCompleting] = useState(false);
  const reduceMotion = useReduceMotion();
  const { play: playCardPlace } = useSoundVariants(FREECELL_CARD_PLACE, FREECELL_SOUNDS);
  // Card motion and the sounds timed to it (#3573; docs/games/freecell.md, "Motion and sound
  // timing"), with Auto-Complete's riffle (#3563), which starts on the run's first card.
  const motion = useFreeCellMotion({ state, autoCompleting, awayRef, reduceMotion, playCardPlace });
  const { riffleRunRef, cueRef, flights, winHold } = motion;
  const { start: startMotion, cueAt, setStepped, holdRiffle, stop: stopMotion } = motion;
  useEffect(() => {
    leaveMotionRef.current = motion.leave;
  }, [motion.leave]);
  /** Best moves after this win, and whether the win beat the old best — for the result card. */
  const [winSummary, setWinSummary] = useState<{ best: number; isNewBest: boolean } | null>(null);
  /**
   * The loaded save was already won — the app was closed between the win and
   * `clearGame()`. Its result was submitted and its celebration played back then.
   */
  const [resumedWin, setResumedWin] = useState(false);
  // The card's rank line, "View leaderboard" link and ⋯ menu item (#2633).
  const { leaderboard, openLeaderboard } = useGameLeaderboard("freecell", navigation);
  const { lookup: lookupRank, reset: resetSubmission } = leaderboard;

  // #2452 — record each game as a per-session `games` row so FreeCell earns Arcade
  // XP, shows in Profile history and can be measured by the daily challenge. Since
  // #2632 that row is also the leaderboard entry: a win sends its move count as
  // `finalScore` (the board ranks fewest moves first, once per player), and an
  // abandon (the hook's own, or New Game) sends no score, so it never ranks.
  //
  // The partial chunk of actions goes to the recorder when the screen unmounts.
  // Declared before `useGameRecorder`, this cleanup runs first (cleanups run in
  // declaration order), so the chunk is recorded before the recorder's own
  // cleanup saves the session and the abandon's `game_ended` follows.
  const flushMovesRef = useRef<() => void>(() => undefined);
  useEffect(() => () => flushMovesRef.current(), []);
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
  } = useGameRecorder("freecell");
  /** Move count last seen — a rise is the first move of a session. */
  const seenMovesRef = useRef<number | null>(null);
  // Seed of the deal in play, for its `game_started` event (#3281); null for a restored save.
  const dealPickRef = useRef<DealPick | null>(null);

  // The replay log (#3289): actions collect in memory and are recorded 25 at a
  // time, as one `moves` event and one recorder unit each; the recorder saves
  // them at an idle moment, never inside a drag, a tap or an Auto Complete step.
  const moveLog = useMoveLog("freecell", { beginUnit, record: recordEvent, closeUnit });
  // False for a restored game whose original session was not resumed (its new
  // session has no deal seed in game_started) or whose earlier actions were never
  // counted: its actions could never be replayed, so none is recorded.
  const recordingRef = useRef(true);
  useEffect(() => {
    flushMovesRef.current = moveLog.flush;
  }, [moveLog]);
  // Going to the background (or another screen covering the game) may end in a kill: record the chunk in progress and
  // save everything waiting now, not at an idle moment that may never come.
  useFlushOnBackground(() => {
    moveLog.flush();
    guardRecording("freecell", flushRecorder);
  }, navigation);
  /** Open the game's session at its first action, if it is not open yet (see the first-move effect). */
  const ensureSessionOpen = useCallback(() => {
    if (syncGetGameId()) return;
    syncStart(dealEventData(dealPickRef.current ?? undefined));
    syncMarkStarted();
  }, [syncGetGameId, syncStart, syncMarkStarted]);
  /**
   * Log an action that produced `next`, and stamp the count of logged actions on
   * it (saved with the game, so a resumed game numbers its chunks on). The session
   * opens first, so what is recorded always has a game to be saved under. The
   * game's last action closes its chunk, so the win's `game_ended` follows it.
   */
  const recordAction = useCallback(
    (action: Action, next: FreeCellState): FreeCellState => {
      if (!recordingRef.current) return next;
      ensureSessionOpen();
      moveLog.push(action);
      if (next.isComplete) moveLog.flush();
      return withRecorded(next, moveLog.count, moveLog.rows);
    },
    [ensureSessionOpen, moveLog]
  );

  // #2450 / #2619 — the abandon result block (backend FreeCellResult). Both the
  // hook's own abandon (unmount) and the New Game abandon build it here.
  const progressResult = useCallback(
    () => ({ won: false, moves: stateRef.current?.moveCount ?? 0 }),
    [stateRef]
  );
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: progressResult() }));
  }, [syncSetProgressSnapshot, progressResult]);

  const [showNoMovesBanner, setShowNoMovesBanner] = useState(false);

  const { play: playSupermove } = useSound("freecell.supermove", FREECELL_SOUNDS);
  const { play: playNoMoves } = useSound("freecell.noMoves", FREECELL_SOUNDS);
  const { play: playGameWin } = useSound("freecell.gameWin", FREECELL_SOUNDS);

  /**
   * Runs Auto-Complete from `fromState`: one card per step, AUTO_STEP_MS apart, the board
   * input-locked (#2225). Only the Auto-Complete button starts it (#3566): a move, a resume
   * and an Undo never do. Its first card waits `firstStepMs` (one step by default).
   */
  const startAutoComplete = useCallback(
    (fromState: FreeCellState, firstStepMs: number = AUTO_STEP_MS) => {
      if (autoCompletingRef.current) return;
      if (!canAutoComplete(fromState)) return;
      autoCompletingRef.current = true;
      setAutoCompleting(true);

      const release = () => {
        autoCompletingRef.current = false;
        setAutoCompleting(false);
        setStepped(false);
      };

      const step = (current: FreeCellState) => {
        if (!isMountedRef.current) return;
        // From the first automatic card on (the move that started the run keeps its sound).
        riffleRunRef.current = true;
        setStepped(true);
        // The board is input-locked while this runs (#2225), so every way out
        // of a step — including a throw — must release the lock, or the player
        // is left with a board that rejects every tap.
        let scheduled = false;
        try {
          // The board is this step's; the clock is the live one. A pause or resume while
          // the step was queued (app backgrounded mid-run) changed only the live clock, so
          // the step must not restore the clock it captured with the board.
          const live = stateRef.current;
          if (live !== null && live.clock !== current.clock) current = withClockOf(live, current);
          const autoMove = nextAutoMove(current);
          const stepped = autoComplete(current);
          const computed = stepped === current ? current : clockMove(current, stepped);
          // Each step is one logged action, in memory: no save per card (#3289).
          const next =
            computed !== current && autoMove !== null
              ? recordAction(moveAction(current, autoMove, true), computed)
              : computed;
          // Each card flies to its foundation (AUTO_FLIGHT_MS) while the steps keep their
          // pace, so about two are in the air; the riffle plays on until the last landing.
          if (next !== current) {
            startMotion("auto", current, next);
            if (next.isComplete) holdRiffle();
          }
          if (next === current || next.isComplete) {
            setState(next === current ? current : next);
            return;
          }
          setState(next);
          autoStepTimeoutRef.current = setTimeout(() => step(next), AUTO_STEP_MS);
          scheduled = true;
        } catch (e) {
          Sentry.captureException(e, { tags: { subsystem: "autoComplete", game: "freecell" } });
        } finally {
          if (!scheduled) release();
        }
      };

      autoStepTimeoutRef.current = setTimeout(() => step(fromState), firstStepMs);
    },
    [setState, recordAction, riffleRunRef, clockMove, stateRef, startMotion, holdRiffle, setStepped]
  );

  // Track mount status for async safety
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoStepTimeoutRef.current !== null) clearTimeout(autoStepTimeoutRef.current);
    };
  }, []);

  // Each sound is timed to its card's motion (#3573): `ms` after the action started, from its
  // cues (all 0 with Reduce Motion). A cue still pending is dropped on a new deal, on leaving
  // the game and on unmount; one due while the player is away is not played.
  useGameEvents(
    state?.events,
    {
      // card place 40 ms before the contact (none when nothing moved: a card sent back before
      // it left)
      cardPlace: () => {
        const c = cueRef.current;
        if (!riffleRunRef.current && c.moved) cueAt(playCardPlace, c.place, "place");
        setShowNoMovesBanner(false);
      },
      // the multi-move's landing peak on the run's last contact; a dropped run plays card place
      supermove: () => {
        const c = cueRef.current;
        if (c.moved) {
          if (c.kind === "drop") cueAt(playCardPlace, c.place, "place");
          else cueAt(playSupermove, c.multi, "multi");
        }
        setShowNoMovesBanner(false);
      },
      // with the riffle's settle: its peak on the last contact
      gameWin: () => {
        cueAt(playGameWin, cueRef.current.settle);
        setShowNoMovesBanner(false);
      },
      // the "stuck" sound on the move's landing, like its other cues (#3712 review); the banner
      // at once (it fits the bottom band, so the board is not re-laid out under the flight)
      noMovesAvailable: () => {
        cueAt(playNoMoves, cueRef.current.landed);
        setShowNoMovesBanner(true);
      },
    },
    // A completed game keeps its events: a new state would be saved again after the
    // win's clear, and the next mount would resume the won board (#3087). The
    // identity check above already keeps them from firing twice.
    () => setState((prev) => (prev === null || prev.isComplete ? prev : { ...prev, events: [] }))
  );

  // Open the session on the first move made here — not on load, so opening a
  // resumed or untouched game records nothing. Watching the move count (rather than
  // hooking handleMove) also covers drag, tap and auto-complete: a resumed game whose
  // remaining cards all go straight to the foundation auto-completes on load, and
  // that finish is recorded — it is the player's own game. Must run before the win
  // effect below: a winning move opens and closes the session in one commit.
  useEffect(() => {
    if (state === null || !hasLoadedRef.current) return;
    const previous = seenMovesRef.current;
    seenMovesRef.current = state.moveCount;
    if (previous !== null && state.moveCount > previous) ensureSessionOpen();
  }, [state, ensureSessionOpen, hasLoadedRef]);

  // The win (useCompletionTransition, #3087): end the session and clear the save on
  // the step to complete, then record the win once per game. A resumed, already-won
  // game (marked by the restore below) only has its save cleared: its session ended
  // and its win was counted when it happened.
  const finishGame = (s: FreeCellState): string | null => {
    const gameId = syncComplete(
      {
        finalScore: s.moveCount,
        outcome: "completed",
        result: { won: true, moves: s.moveCount },
      },
      {
        final_score: s.moveCount,
        outcome: "completed",
        won: true,
        moves: s.moveCount,
      }
    );
    clearSavedGame();
    return gameId;
  };
  const { markRestoredComplete, reset: resetCompletion } = useCompletionTransition(
    state,
    state?.isComplete ?? false,
    {
      onComplete: (s) => {
        const gameId = finishGame(s);
        const finalMoves = s.moveCount;
        // Only a win that happened this session has a session to rank.
        if (gameId) void lookupRank(gameId);
        const { best, improved, isNewBest } = judgeResult(
          "freecell",
          bestMovesRef.current,
          finalMoves
        );
        setWinSummary({ best, isNewBest });
        bestMovesRef.current = best;
        if (improved) void recordResult("freecell", finalMoves);
      },
      onAlreadyComplete: finishGame,
    }
  );

  // Mount: resume the saved game, or deal fresh in its place. After the win hook, whose
  // guard it sets for a resumed won game (a layout-time registration: its place among
  // the effects above changes nothing).
  useGameRestored(game, (saved) => {
    // A load that lands while the player is already away (app backgrounded, screen
    // covered) starts paused: the pause callback ran against no state, and fires again
    // only on the next change. Applied in the load's own batch (#3607).
    if (saved && awayRef.current) setState((s) => (s === null ? s : pauseGame(s)));
    // The deal's seed is kept for the session's `game_started` event (#3281);
    // a saved game does not store it.
    if (!saved) dealPickRef.current = drawDealSeed();
    const initial = saved ?? dealGame(dealPickRef.current?.seed);
    if (!saved) setState(initial);
    // A restored game continues the session a killed app left open (#2654); its
    // replay chunks carry on from the actions the save counted (#3289).
    if (saved && !saved.isComplete) {
      const start = recordedStart(saved);
      moveLog.reset(start ?? 0, savedRows(saved.recordedRows));
      recordingRef.current = syncResume() && start !== null;
      // Not recorded: drop the count from the state, so the next load of this game
      // (a game with history and no count) is not recorded either.
      if (!recordingRef.current) setState((s) => (s === null ? s : withoutRecorded(s)));
      // A save made before its events were cleared (the app killed mid-move) replays nothing:
      // no sound and no motion on restore (#3573), as for a won game below.
      if ((saved.events?.length ?? 0) > 0) {
        setState((s) => (s === null ? s : { ...s, events: [] }));
      }
    }
    // Suppress re-counting a win when resuming an already-won game.
    if (saved?.isComplete) {
      // The winning move was saved with its events, and a save the win never got to
      // clear still holds them: drop them in the same batch as the load, so the win's
      // sound and animation don't play again (#3087).
      setState({ ...saved, events: [] });
      markRestoredComplete();
      setResumedWin(true);
      setWinSummary({ best: bestMovesRef.current, isNewBest: false });
    }
  });

  const handleMove = useCallback(
    (move: Move, offset?: DropOffset) => {
      // A won game is over, its result card perhaps still held for the last landing (#3573).
      if (state === null || state.isComplete || autoCompletingRef.current) return;
      const moved = applyMove(state, move);
      if (moved === state) return;
      // A tap flies the card from its slot; a drop settles it from where the ghost was let go.
      startMotion(offset ? "drop" : "tap", state, moved, offset);
      const applied = clockMove(state, moved);
      const next = recordAction(moveAction(state, move), applied);
      setState(next);
    },
    [state, recordAction, setState, clockMove, startMotion]
  );

  const handleUndo = useCallback(() => {
    if (state === null || state.isComplete || autoCompletingRef.current) return;
    if (state.undoStack.length === 0) return;
    setShowNoMovesBanner(false);
    // An undo restores the board, not the clock (#3607).
    const undone = withClockOf(state, undoMove(state));
    // The cards fly back, with one card place on the last landing (as Solitaire, owner).
    if (startMotion("undo", state, undone).moved > 0) {
      cueAt(playCardPlace, cueRef.current.place, "place");
    }
    // An undo is part of the replay (it restores the board and the move count).
    // Recorded once the game has recorded an action; there is a session by then.
    // An undo restores an older snapshot, which carries an older count: a game
    // that is not recorded drops it.
    if (!recordingRef.current) setState(withoutRecorded(undone));
    else setState(moveLog.count > 0 ? recordAction(undoAction(), undone) : undone);
  }, [state, moveLog, recordAction, setState, startMotion, cueAt, cueRef, playCardPlace]);

  const handleHint = useCallback(() => {
    if (state === null || state.isComplete) return;
    if (getHintMoves(state).length === 0) {
      playNoMoves();
      setShowNoMovesBanner(true);
      return;
    }
    const hinted = withClockOf(state, applyHint(state));
    // A hint asked for before the first move belongs to no recorded game yet.
    setState(
      recordingRef.current && moveLog.count > 0 ? recordAction(hintAction(), hinted) : hinted
    );
  }, [state, moveLog, recordAction, setState, playNoMoves]);

  const handleNewGame = useCallback(() => {
    // The last chunk of actions goes to the recorder first, so the abandon saves it to this game.
    moveLog.flush();
    // Close the current session as abandoned (a no-op after a win or before a move).
    if (syncGetGameId()) {
      const result = progressResult();
      syncComplete({ outcome: "abandoned", result }, { outcome: "abandoned", ...result });
    }
    // The new deal's play time starts now, though its session opens at the
    // first move: the thinking time before that move counts, and time spent on
    // the previous board or its result card does not (#2710).
    syncResetPlayWindow();
    // Stop an in-flight auto-complete. Its next scheduled step would otherwise overwrite
    // the new deal with the old game's state — and, since that state's move count is
    // above zero, the first-move effect would open a second session for the old game.
    if (autoStepTimeoutRef.current !== null) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }
    autoCompletingRef.current = false;
    setAutoCompleting(false);
    // Every card lands, every pending cue goes and the holds are released (#3573).
    stopMotion();
    seenMovesRef.current = 0;
    clearSavedGame();
    dealPickRef.current = drawDealSeed();
    moveLog.reset(0);
    recordingRef.current = true;
    // A new deal starts the Large cards decision afresh.
    setLargeDecision((d) => (d.fallbackAt === null ? d : { ...d, fallbackAt: null }));
    setState(dealGame(dealPickRef.current.seed));
    resetCompletion();
    setResumedWin(false);
    setWinSummary(null);
    resetSubmission();
  }, [
    syncGetGameId,
    syncComplete,
    syncResetPlayWindow,
    resetSubmission,
    resetCompletion,
    progressResult,
    clearSavedGame,
    setState,
    moveLog,
    stopMotion,
  ]);

  // `shellLoading` also holds the board back until the stored choice is read.
  // The menu shows `largeCards`; the board is drawn at `boardLargeCards`, which
  // catches up once the ⋯ menu has closed (#3556, see useLargeCards).
  const { largeCards, boardLargeCards, toggleLargeCards, shellLoading } = useLargeCards(loading);

  const undoDisabled =
    state === null || state.undoStack.length === 0 || state.isComplete || autoCompleting;
  const hintDisabled = state === null || state.isComplete || autoCompleting;
  // The Auto-Complete button (#3566): offered exactly while the board can finish itself.
  const showAutoComplete = useMemo(
    () => state !== null && !state.isComplete && !autoCompleting && canAutoComplete(state),
    [state, autoCompleting]
  );
  const handleAutoComplete = useCallback(() => {
    if (state === null || state.isComplete) return;
    startAutoComplete(state);
  }, [state, startAutoComplete]);
  // The felt's size (#3607): what the screen's chrome leaves (the window less the
  // header, the stat line, the tab bar and the gutters) until the felt reports its
  // own size, then the measured one. As in SolitaireScreen.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const tabBarHeight = useSafeBottomTabBarHeight();
  const insets = useSafeAreaInsets();
  // The stat line grows or wraps with the font scale: its measured height, not a constant.
  const [statLineHeight, setStatLineHeight] = useState(TABLE_STAT_LINE_HEIGHT);
  const handleStatLayout = useCallback((e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) setStatLineHeight((prev) => (prev === height ? prev : height));
  }, []);
  // The bottom band holds the no-moves banner; it wraps at large font scales, so it is
  // measured too. It only grows: a band that shrank when the banner went away would
  // re-lay the board out under the finger.
  const [bandHeight, setBandHeight] = useState(TABLE_BOTTOM_BAND);
  const handleBandLayout = useCallback((e: LayoutChangeEvent) => {
    const { height } = e.nativeEvent.layout;
    if (height > 0) setBandHeight((prev) => Math.max(prev, height));
  }, []);
  const [measuredFelt, setMeasuredFelt] = useState<{ width: number; height: number } | null>(null);
  const feltSize =
    measuredFelt ??
    estimateFeltSize({
      windowWidth,
      windowHeight,
      sideInsets: {
        left: Math.max(insets.left, FELT_GUTTER),
        right: Math.max(insets.right, FELT_GUTTER),
      },
      headerHeight: APP_HEADER_HEIGHT + insets.top,
      statLineHeight,
      // First frame only (the felt is measured once laid out). Since #3624 the tab bar sits in
      // flow below the screen (BottomTabBar: 60 plus `insets.bottom || 8`) and the screen pads
      // only its own 16 dp gap; without a tab bar the shell clears the bottom inset instead.
      bottomHeight: (tabBarHeight > 0 ? 60 + (insets.bottom || 8) : insets.bottom) + 16,
    });
  const handleFeltLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    if (width <= 0 || height <= 0) return;
    setMeasuredFelt((prev) =>
      prev !== null && prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);
  // The board sits inside the felt's rim. Large cards (#3347) keep their fixed width and
  // scroll sideways; only the steps compress, so the board still never scrolls vertically.
  const feltInner = {
    width: feltSize.width - 2 * FELT_BORDER_WIDTH,
    height: feltSize.height - 2 * FELT_BORDER_WIDTH,
  };
  // Large cards only while the tallest column keeps an 18 dp stripe with them; otherwise the
  // fitted cards (owner decision, #3607). The horizontal scroller stays mounted either way
  // (`scrollable` follows the setting), so a switch never remounts the board.
  // The fallback carries hysteresis (`fallbackAt`, #3607 review): kept in state across
  // renders, reset on a new deal (`handleNewGame`) and when the setting is toggled.
  const tableau = state?.tableau;
  const priorFallbackAt =
    largeDecision.largeCards === boardLargeCards ? largeDecision.fallbackAt : null;
  const {
    geometry,
    large: largeGeometry,
    fallbackAt,
  } = useMemo(
    () =>
      freeCellBoardGeometry({
        width: feltInner.width,
        height: feltInner.height,
        bottomBand: bandHeight,
        largeCards: boardLargeCards,
        tableau: tableau ?? [],
        fallbackAt: priorFallbackAt,
      }),
    [feltInner.width, feltInner.height, bandHeight, boardLargeCards, tableau, priorFallbackAt]
  );
  // Adjusting state while rendering (React's pattern for state derived from the previous
  // render): the next render reads the new decision before anything is committed.
  if (largeDecision.largeCards !== boardLargeCards || largeDecision.fallbackAt !== fallbackAt) {
    setLargeDecision({ largeCards: boardLargeCards, fallbackAt });
  }
  const boardOverflows =
    largeGeometry && largeBoardOverflows(feltInner.width, geometry.cardWidth, geometry.gap);
  const cardSize = useMemo(
    () => ({ cardWidth: geometry.cardWidth, cardHeight: geometry.cardHeight }),
    [geometry.cardWidth, geometry.cardHeight]
  );
  // The planner's geometry (#3573): the board as drawn now, and the card size it will be drawn
  // at after a move (a move that flips Large cards' fallback is not animated).
  const cardWidthAfter = useCallback(
    (s: FreeCellState) =>
      freeCellBoardGeometry({
        width: feltInner.width,
        height: feltInner.height,
        bottomBand: bandHeight,
        largeCards: boardLargeCards,
        tableau: s.tableau,
        fallbackAt,
      }).geometry.cardWidth,
    [feltInner.width, feltInner.height, bandHeight, boardLargeCards, fallbackAt]
  );
  useFreeCellMotionGeometry(motion, geometry, cardWidthAfter);
  // Cards off the felt (#3653): checked after a layout change, against the measured felt only.
  // The step is the board's own (FreeCellBoard: `faceUpStepFor` over every column, all face
  // up). While the setting is on the board sits in a horizontal scroller (padding, and the
  // button strip while it overflows). Drawn with Large cards it is meant to be wider than
  // the felt, so only its height is checked; the tag and the width check follow what is
  // drawn (`largeGeometry`), not the setting.
  const deckId = useDeck().activeDeck.id;
  const columnCounts = useMemo(
    () => (tableau ?? []).map((pile) => ({ down: 0, up: pile.length })),
    [tableau]
  );
  useEffect(() => {
    reportTableauOffTable({
      game: "freecell",
      measuredFelt,
      feltBorder: FELT_BORDER_WIDTH,
      geometry,
      faceUpStep: faceUpStepFor(geometry, columnCounts),
      columns: columnCounts,
      boardWidth: freeCellBoardWidth(geometry.cardWidth, geometry.gap),
      // The scroller (and its padding) is mounted while the setting is on, whatever is drawn.
      topOffset: boardLargeCards ? SCROLL_PAD + (boardOverflows ? SCROLL_BAR_HEIGHT : 0) : 0,
      // Only the Large-card board is meant to be wider than the felt; a fitted board inside
      // the scroller (a fallback) must fit it.
      checkWidth: !largeGeometry,
      deck: deckId,
      largeCards: largeGeometry,
      insets,
    });
  }, [
    measuredFelt,
    geometry,
    columnCounts,
    boardLargeCards,
    largeGeometry,
    boardOverflows,
    deckId,
    insets,
  ]);

  // Stable, so the clock does not re-render for it.
  const timeA11y = useCallback((time: string) => t("freecell:stat.timeA11y", { time }), [t]);

  return (
    <GameShell
      gameType="freecell"
      title={t("freecell:game.title")}
      requireBack
      loading={shellLoading}
      gutter={FELT_GUTTER}
      style={{ paddingBottom: 16 }}
      onNewGame={handleNewGame}
      onOpenLeaderboard={openLeaderboard}
      menuToggle={{
        label: t("freecell:settings.largeCards"),
        value: largeCards,
        onToggle: toggleLargeCards,
        testID: "freecell-large-cards-toggle",
      }}
      rightSlot={
        <View style={styles.headerBtnRow}>
          <PillButton
            testID="freecell-hint-button"
            label={t("freecell:action.hint")}
            onPress={handleHint}
            disabled={hintDisabled}
            color={colors.bonus}
          />
          <PillButton
            label={t("freecell:action.undo")}
            onPress={handleUndo}
            disabled={undoDisabled}
          />
        </View>
      }
    >
      {state !== null && (
        <CardSizeContext.Provider value={cardSize}>
          <View style={styles.body}>
            {/* TIME is the display-only play clock; `durationMs` stays on useGameSync's window. */}
            <TableStatLine
              onLayout={handleStatLayout}
              testID="freecell-stat-line"
              stats={[
                {
                  key: "moves",
                  label: t("freecell:stat.moves"),
                  value: String(state.moveCount),
                  accessibilityLabel: t("freecell:score.moves", { moves: state.moveCount }),
                  testID: "freecell-stat-moves",
                },
                {
                  key: "time",
                  label: t("freecell:stat.time"),
                  renderValue: (valueStyle) => (
                    <PlayClockText
                      testID="freecell-stat-time"
                      startedAt={state.clock?.startedAt ?? null}
                      accumulatedMs={state.clock?.accumulatedMs ?? 0}
                      style={valueStyle}
                      accessibilityLabel={timeA11y}
                    />
                  ),
                },
              ]}
            />

            <FeltTable testID="freecell-felt" style={styles.felt} onLayout={handleFeltLayout}>
              <View
                testID="freecell-board"
                style={styles.boardWrap}
                accessibilityLabel={t("freecell:a11y.boardRegion")}
              >
                <CardFlightContext.Provider value={flights}>
                  <FreeCellBoard
                    state={state}
                    onMove={handleMove}
                    inputLocked={autoCompleting}
                    geometry={geometry}
                    scrollable={boardLargeCards}
                    overflows={boardOverflows}
                    reduceMotion={reduceMotion}
                  />
                </CardFlightContext.Provider>
              </View>

              <View
                style={styles.bottomBand}
                onLayout={handleBandLayout}
                pointerEvents="box-none"
                testID="freecell-bottom-band"
              >
                <FreeCellBandContent
                  showAutoComplete={showAutoComplete}
                  showNoMoves={showNoMovesBanner}
                  onAutoComplete={handleAutoComplete}
                  onUndo={handleUndo}
                  undoDisabled={undoDisabled}
                />
              </View>
            </FeltTable>
          </View>
        </CardSizeContext.Provider>
      )}
      {state !== null ? (
        <GameResultModal
          // The result card waits for the winning card's landing (#3573).
          visible={state.isComplete && !winHold}
          outcome="win"
          eyebrow={t("game.title")}
          subtitle={tResult("subtitle.completedIn", { count: state.moveCount })}
          hero={{ kind: "score", label: tResult("stat.moves"), value: state.moveCount }}
          isNewBest={winSummary?.isNewBest ?? false}
          stats={
            winSummary && winSummary.best > 0
              ? [{ label: tResult("stat.best"), value: winSummary.best }]
              : []
          }
          submission={toSubmission(leaderboard)}
          onViewLeaderboard={openLeaderboard}
          onPlayAgain={handleNewGame}
          onHome={() => navigation.popToTop()}
          // Only a win that just happened plays the celebration; a resumed,
          // already-won game goes straight to the card.
          celebration={
            resumedWin ? undefined : (done) => <FreeCellGameWinAnimation visible onDismiss={done} />
          }
          testID="freecell-result"
        />
      ) : null}
    </GameShell>
  );
}

/**
 * The felt's bottom band: the Auto-Complete pill (#3566) or the no-moves banner, never
 * both. An auto-completable board always has a move, so a stale banner never shares the
 * band with the button.
 */
export function FreeCellBandContent({
  showAutoComplete,
  showNoMoves,
  onAutoComplete,
  onUndo,
  undoDisabled,
}: {
  showAutoComplete: boolean;
  showNoMoves: boolean;
  onAutoComplete: () => void;
  onUndo: () => void;
  undoDisabled: boolean;
}) {
  const { t } = useTranslation("freecell");
  const { colors } = useTheme();
  return (
    <>
      {showNoMoves && !showAutoComplete && (
        <View
          style={[
            styles.noMovesBanner,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
          ]}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          <Text style={[styles.noMovesText, { color: colors.text }]}>
            {t("freecell:noMoves.message")}
          </Text>
          <PillButton label={t("freecell:action.undo")} onPress={onUndo} disabled={undoDisabled} />
        </View>
      )}
      {showAutoComplete && <AutoCompleteButton onPress={onAutoComplete} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
  body: {
    flex: 1,
  },
  headerBtnRow: {
    flexDirection: "row",
    gap: 6,
  },
  felt: {
    flex: 1,
    marginTop: TABLE_FELT_MARGIN_TOP,
    marginBottom: TABLE_FELT_MARGIN_BOTTOM,
    alignItems: "center",
  },
  // Centres the normal board; the Large-cards scroller stretches across the felt.
  boardWrap: {
    alignSelf: "stretch",
    alignItems: "center",
  },
  // The felt's bottom band (#3607): the no-moves banner, kept out of the tableau's way by
  // the geometry (`bottomBand`), so it never covers a column's last cards.
  bottomBand: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: TABLE_BOTTOM_BAND,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 12,
    paddingBottom: 6,
  },
  noMovesBanner: {
    flex: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    columnGap: 12,
    rowGap: 4,
  },
  noMovesText: {
    flexShrink: 1,
    fontSize: 13,
    fontWeight: "600",
  },
});
