/**
 * Twenty48Screen — 2048 on a 4×4 board.
 *
 * Concerns:
 *   1. Game logic — swipes (RNGH Pan) and, on web, arrow keys go to the pure engine's
 *      `move`; its tile-id counter is restored by `loadGame` (`seedNextTileId`, #698).
 *   2. Persistence — `usePersistedGameState` (#3109) restores the save on mount (or deals
 *      fresh) and saves every change with one-shot `events` stripped; the game-over edge
 *      (`useCompletionTransition`) clears it.
 *   3. Play clock (#2735, #2750) — `usePausableClock` pauses it on blur and background.
 *   4. Instrumentation (#369, #549) — `useGameRecorder("twenty48")` (useGameSync + the shared
 *      recorder; moves go in chunks, #3286), one session per game; the
 *      2048 win completes it and Keep Playing is untracked (#2631); a restored game resumes
 *      its session (#2654).
 *   5. Result + leaderboard (#2513, #2633) — the shared GameResultModal; "new best" from
 *      `bestOf`; ranked via `useGameLeaderboard`.
 *   6. Audio — engine events play the 2048 and game-over sounds.
 */
import React, { useEffect, useLayoutEffect, useMemo, useState, useCallback, useRef } from "react";
import {
  View,
  StyleSheet,
  Platform,
  AccessibilityInfo,
  LayoutChangeEvent,
  Text,
} from "react-native";
import { GestureDetector, Gesture } from "react-native-gesture-handler";
import { useTranslation } from "react-i18next";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import { bestOf } from "../game/_shared/bestOf";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { useCompletionTransition } from "../game/_shared/useCompletionTransition";
import { useGameRestored, usePersistedGameState } from "../game/_shared/usePersistedGameState";
import { usePausableClock } from "../hooks/usePausableClock";
import { Twenty48State } from "../game/twenty48/types";
import {
  newGame,
  move as engineMove,
  pauseGame,
  resumeGame,
  suggestMove,
  Direction,
} from "../game/twenty48/engine";
import {
  saveGame,
  loadGame,
  clearGame,
  saveBestScore,
  loadBestScore,
} from "../game/twenty48/storage";
import Grid from "../components/twenty48/Grid";
import { useTwenty48Beat } from "../components/twenty48/useTwenty48Beat";
import { MOVE_LOCK_MS } from "../game/twenty48/motion";
import { SWIPE_THRESHOLD_PX, createMoveQueue, createSwipeTracker } from "../game/twenty48/input";
import HintOverlay, { hintText } from "../components/twenty48/HintOverlay";
import GameActionBar from "../components/shared/GameActionBar";
import { useTransientToast } from "../components/shared/useTransientToast";
import ScoreBoard from "../components/twenty48/ScoreBoard";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import StatsBento from "../components/twenty48/StatsBento";
import NewGameConfirmModal from "../components/shared/NewGameConfirmModal";
import { useGameRecorder } from "../game/_shared/useGameRecorder";
import { useFlushOnBackground } from "../game/_shared/useFlushOnBackground";
import {
  createMoveLog,
  guardRecording,
  moveTuple,
  savedPosition,
  withRecorded,
} from "../game/twenty48/replay";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import { useSound } from "../game/_shared/useSound";
import { TWENTY48_SOUNDS, TWENTY48_TILE_MERGE, TWENTY48_TILE_SPAWN } from "../game/twenty48/sounds";
import { useSoundVariants } from "../game/_shared/useSoundVariants";

function flattenBoard(board: number[][]): number[] {
  return board.flat();
}

function highestTile(board: number[][]): number {
  return Math.max(0, ...board.flat());
}

function computeDurationMs(s: Twenty48State): number {
  return s.accumulatedMs + (s.startedAt !== null ? Date.now() - s.startedAt : 0);
}

/** How long (ms) a hint, or the "no hint" message, stays up: the same 2 s as the other games. */
const HINT_MS = 2000;
/** The action bar under the board (Hint, New Game). */
const ACTION_BAR_H = 64;
/** The board keeps this much clear above and below it in the free height. */
const BOARD_V_MARGIN = 8;
/** Below this measured height the area is not laid out yet: the board keeps its width cap. */
const MIN_BOARD = 120;

type Props = {
  navigation: NativeStackNavigationProp<HomeStackParamList, "Twenty48">;
};

export default function Twenty48Screen({ navigation }: Props) {
  const { t } = useTranslation(["twenty48", "common"]);
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();

  // The best score as the mount load read it, for the restore below.
  const loadedBestRef = useRef(0);
  // The saved game as the restore applied it: already stored, so not written
  // back (a fresh deal is saved at once instead).
  const restoredRef = useRef<Twenty48State | null>(null);
  // The saved game (usePersistedGameState, #3109), loaded with the best score
  // on mount. The best score is the only local figure kept: the result card's
  // "New best" badge compares with it. The old `twenty48_stats_v1` counters are
  // no longer read or written (#2636); the Stats screen reads the server.
  // Every change is saved once the load has landed, with the one-shot events
  // stripped (they must never replay on reload); the fresh game a clean slot
  // deals is saved at once, and a restored game is not written back. Called before the game-over edge, so a losing move
  // is saved before that edge clears it. `stateRef` is the latest state, for
  // the progress snapshot and New Game. The restore is below.
  const game = usePersistedGameState<Twenty48State>({
    load: async () => {
      const [saved, best] = await Promise.all([loadGame(), loadBestScore()]);
      loadedBestRef.current = best;
      return saved;
    },
    save: (s) =>
      s === restoredRef.current ? Promise.resolve() : saveGame({ ...s, events: undefined }),
    clear: clearGame,
  });
  const { state, setState, stateRef, loading, clear: clearSavedGame } = game;
  const [winDismissed, setWinDismissed] = useState(false);
  /** The move that made 2048 also ended the game: the card is still the win. */
  const [wonOnLastMove, setWonOnLastMove] = useState(false);
  const [bestScore, setBestScore] = useState(0);
  // Best score before the current game began: bestScore rises live with the
  // score, so "New Best" compares against this instead (#2513).
  const [bestAtGameStart, setBestAtGameStart] = useState(0);
  const [confirmNewGameVisible, setConfirmNewGameVisible] = useState(false);
  // The hint (#3688): the suggested swipe, shown for 2 s and cleared by a swipe; with no move to
  // suggest, a 2 s "no hint" message, as in Mahjong (useTransientToast, #2981). A hint changes no
  // state of the game and is not recorded: the replay's move format (docs/games/twenty48.md) has
  // no slot for it, and 2048 scores no cost for one.
  const [hintDirection, setHintDirection] = useState<Direction | null>(null);
  const { visible: hintVisible, show: showHint, hide: hideHint } = useTransientToast(HINT_MS);
  const { visible: noHintVisible, show: showNoHint, hide: hideNoHint } = useTransientToast(HINT_MS);
  // The free height for the board, measured: the board is centred in it and capped to it.
  const [boardAreaHeight, setBoardAreaHeight] = useState<number | null>(null);
  const onBoardAreaLayout = useCallback((e: LayoutChangeEvent) => {
    const h = Math.round(e.nativeEvent.layout.height);
    setBoardAreaHeight((prev) => (prev === h ? prev : h));
  }, []);

  /** Blocks new moves while the slide animation plays. */
  const movingRef = useRef(false);
  // The move lock's timer: cleared by New Game and on unmount, so an old move's lock can't end a
  // new move's early or run a queued move on a board that is gone (#3725 review).
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Up to `MOVE_QUEUE_DEPTH` moves made during the lock: each fires as the one before it ends
   * (#3689).
   */
  const [moveQueue] = useState(createMoveQueue);
  // The end-of-game beat: holds the result card while the 2048 tile forms or the stuck board
  // dims (#3689). Started in the move handler that ends the game, so the hold and the ended
  // board land in one render.
  const { beat, start: startBeat, clear: clearBeat } = useTwenty48Beat();
  /** Guards against double-counting a win within a single game session. */
  const winRecordedRef = useRef(false);

  // Levels are set in the files (#3578): the spawn, on every swipe, is the quietest sound.
  const { play: playTileMerge } = useSoundVariants(TWENTY48_TILE_MERGE, TWENTY48_SOUNDS);
  const { play: playTileSpawn } = useSoundVariants(TWENTY48_TILE_SPAWN, TWENTY48_SOUNDS);
  const { play: playWin2048 } = useSound("twenty48.win2048", TWENTY48_SOUNDS);
  const { play: playGameOverSound } = useSound("twenty48.gameOver", TWENTY48_SOUNDS);

  // Game event instrumentation (#369 / #549). One session per game from load /
  // reset until the 2048 tile (`win`) or a game over without it (`loss`)
  // (#2631). Keep Playing after the win is untracked: those moves belong to no
  // session, and the board keeps the score at the 2048 moment.
  //
  // The moves are recorded through the shared recorder (#3286): `moveLog`
  // collects them in memory and hands a chunk of MOVES_PER_CHUNK over as one
  // `moves` event and one recorder unit (docs/games/twenty48.md). Declared
  // before `useGameRecorder`, this effect's cleanup runs first on unmount
  // (cleanups run in declaration order), so the partial chunk reaches the
  // recorder before its own cleanup saves the session and the abandon's
  // `game_ended` follows.
  const flushMovesRef = useRef<() => void>(() => undefined);
  useEffect(() => () => flushMovesRef.current(), []);
  useEffect(
    () => () => {
      if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    },
    []
  );
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    setProgressSnapshot: syncSetProgressSnapshot,
    beginUnit,
    record: recordEvent,
    closeUnit,
    flush: flushRecorder,
  } = useGameRecorder("twenty48");
  // One log for the screen's life (a lazy state initialiser), so its counts
  // and its chunk in progress survive every render. A chunk is unit `unit` of
  // the game (its row number, carried on across a resume: `reset`); recording
  // runs inside `guardRecording`, so a failure there never reaches play.
  // Created with the first render's callbacks: they are the recorder's own,
  // stable for the screen's game type.
  const [moveLog] = useState(() =>
    createMoveLog((m, unit) =>
      guardRecording(() => {
        beginUnit(unit);
        recordEvent("moves", { m });
        closeUnit();
      })
    )
  );
  const flushMoves = useCallback(() => guardRecording(moveLog.flush), [moveLog]);
  useEffect(() => {
    flushMovesRef.current = flushMoves;
  }, [flushMoves]);
  // The card's leaderboard line (#2631, #2677): looked up once per session, at
  // the win or the game over; never on an abandon.
  // The card's rank line, "View leaderboard" link and ⋯ menu item (#2633).
  const { leaderboard, openLeaderboard } = useGameLeaderboard("twenty48", navigation);
  const { lookup: lookupRank, reset: resetLeaderboard } = leaderboard;
  const moveCountRef = useRef(0);

  // Another screen covering the game (⋯ → Stats, Leaderboard, Scoreboard,
  // #2735) or the app going to the background (#2750) stops its clock, so
  // the reported duration counts only play (usePausableClock). The paused
  // board is saved on the way out (`saveOnLeave`, without waiting for a render
  // that may never come in the background) and again when it commits, so a
  // kill while backgrounded keeps the time played since the last move. `awayRef` also
  // gates the queued move below: applying it while away would run move()'s
  // timer logic on a paused (`startedAt: null`) state, restarting the clock.
  const { awayRef, adoptLoaded, matchPresence } = usePausableClock({
    navigation,
    state,
    setState,
    pauseGame,
    resumeGame,
    saveOnLeave: (paused) => saveGame({ ...paused, events: undefined }),
  });
  // Going to the background (or another screen covering the game) may end in
  // a kill: hand the chunk in progress to the recorder and save everything
  // waiting now, not at an idle moment that may never come. Not on `inactive`
  // (useFlushOnBackground): each cut-short chunk is a row of the game's limit.
  // The saved row count already includes that chunk (`MoveLog.rows`).
  useFlushOnBackground(() => {
    flushMoves();
    guardRecording(flushRecorder);
  }, navigation);

  // #2450 / #2619 — the board's result block. The hook's own abandon (unmount)
  // and the New Game abandon both build it here. final_score goes in the result
  // (games.metadata) — the daily challenge's score goals read it — but NOT as
  // summary.finalScore on an abandon: that column ranks the game on
  // leaderboards, and an abandon must not (#2468).
  const progressResult = useCallback(
    (s: Twenty48State) => ({
      final_score: s.score,
      highest_tile: highestTile(s.board),
      move_count: moveCountRef.current,
      duration_ms: computeDurationMs(s),
    }),
    []
  );
  useEffect(() => {
    syncSetProgressSnapshot(() => {
      const s = stateRef.current;
      if (!s) return {};
      const result = progressResult(s);
      // Twenty48's own timer, so the abandon's duration is the game's, not the
      // hook's foreground window (#2684).
      return { result, durationMs: result.duration_ms };
    });
  }, [syncSetProgressSnapshot, progressResult, stateRef]);

  // Close the session as a finished game (#2631): `win` when the 2048 card
  // shows, `loss` on a game over without it. New builds never write
  // `kept_playing`. The card then asks where the game ranks.
  const finishSession = useCallback(
    (s: Twenty48State, card: "win" | "loss") => {
      // The last chunk goes to the recorder first: `complete` ends its session.
      flushMoves();
      const outcome = recordedOutcome(card);
      const result = progressResult(s);
      const payload = { ...result, outcome };
      // No open session (a resumed game that already won, or one already
      // finished) means nothing to send.
      const gameId = syncComplete(
        { finalScore: s.score, outcome, durationMs: result.duration_ms, result: payload },
        payload
      );
      if (!gameId) return;
      void lookupRank(gameId);
    },
    [progressResult, syncComplete, lookupRank, flushMoves]
  );

  // Disable back swipe gesture on this screen.
  useEffect(() => {
    navigation.setOptions({ gestureEnabled: false });
  }, [navigation]);

  // When the game ends, remove the saved state so a fresh game starts next
  // launch (useCompletionTransition, #3109). The session is not finished here:
  // the move handler finishes it in the same call as the move (the 2048 win or
  // a game over without it). A game the restore loaded already over only
  // clears its leftover save.
  const { markRestoredComplete, reset: resetGameOver } = useCompletionTransition(
    state,
    !!state?.game_over,
    { onComplete: () => clearSavedGame(), onAlreadyComplete: () => clearSavedGame() }
  );

  // The tiles a restored save opens with: their flags are the last move's, not a new one (#3578).
  const restoredTilesRef = useRef<Twenty48State["tiles"] | null>(null);

  // Mount: resume the saved game, or deal fresh in its place.
  useGameRestored(game, (saved) => {
    // loadGame restarts a saved mid-game's clock from now (#2750): the time
    // played before the app was closed is kept, the time it was closed isn't.
    const next = adoptLoaded(saved ?? newGame());
    if (saved) restoredTilesRef.current = next.tiles;
    setState(next);
    // A load landing while the player is away is paused (`adoptLoaded`), and a
    // paused board is saved, as it always was.
    if (saved && !next.paused) restoredRef.current = next;
    const best = loadedBestRef.current;
    setBestScore(best);
    setBestAtGameStart(best);
    if (next.game_over) markRestoredComplete();
    if (!next.game_over && next.has_won) {
      // A saved game past 2048 was finished at the win (#2631): the rest of
      // it is untracked, so it opens no session. A build from before #2631
      // left its session open while the win card was up, though; if the app
      // was killed then, record that session now as the win it was.
      moveCountRef.current = 0;
      if (saved && syncResume()) finishSession(next, "win");
    } else if (!next.game_over) {
      moveCountRef.current = 0;
      // A saved mid-game continues the session a killed app left open (#2654),
      // and its replay log carries on from the save's counts (#3286): unit
      // numbers continue and the per-game limits hold. A new session (no
      // session to resume) records from this board, so the log starts at 0.
      const resumed = !!saved && syncResume();
      if (resumed) moveLog.reset(...savedPosition(saved));
      if (!resumed) {
        syncStart({ initial_board: flattenBoard(next.board) });
        // Resuming a saved mid-game means the player already started — mark it.
        if (saved) syncMarkStarted();
      }
    }
    // Suppress re-counting a win when resuming an already-won game.
    if (next.has_won) winRecordedRef.current = true;
  });

  // Unmount cleanup is handled by useGameSync (abandons any open session).

  // Update and persist best score whenever score improves.
  useEffect(() => {
    if (!state) return;
    if (state.score > bestScore) {
      setBestScore(state.score);
      saveBestScore(state.score);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.score]); // intentional: only re-run when score changes, not on every state update

  // Fire tile sounds from isMerge/isNew flags on the render layer. A restored save keeps its last
  // move's flags, so the tiles a saved game opens with are skipped: reopening a game must not
  // replay that move's sounds (#3578). A fresh deal still plays its spawn.
  useEffect(() => {
    if (!state || state.tiles === restoredTilesRef.current) return;
    const hasMerge = state.tiles.some((t) => t.isMerge);
    const hasSpawn = state.tiles.some((t) => t.isNew && !t.isMerge);
    if (hasMerge) playTileMerge();
    if (hasSpawn) playTileSpawn();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.tiles]);

  const lastMoveTilesRef = useRef<Twenty48State["tiles"] | null>(null);

  // Announce merges to screen readers: the merged tile values only (not every
  // slide or spawn), so a swipe produces one short message.
  useEffect(() => {
    if (!state || state.tiles !== lastMoveTilesRef.current) return;
    const values = state.tiles.filter((tile) => tile.isMerge).map((tile) => tile.value);
    if (values.length === 0) return;
    AccessibilityInfo.announceForAccessibility(
      t("twenty48:a11y.merged", { values: values.join(", ") })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.tiles]);

  // Fire one-shot event sounds from engine events. The engine emits a new
  // array (win2048 before gameOver) on the move that caused them, and every
  // save and load strips them, so they are left in state rather than cleared.
  useGameEvents(state?.events, {
    win2048: () => playWin2048(),
    gameOver: () => playGameOverSound(),
  });

  const executeMove = useCallback(
    (direction: Direction, currentState: Twenty48State) => {
      movingRef.current = true;
      let moved: Twenty48State;
      try {
        moved = engineMove(currentState, direction);
      } catch {
        // "no effect" or game over — release lock immediately.
        // The board is unchanged, so a move waiting behind this one is still a fair move.
        movingRef.current = false;
        const waiting = moveQueue.shift();
        if (waiting) executeMove(waiting, currentState);
        return;
      }
      // Moves after the win (Keep Playing) belong to no session: not recorded.
      // A recorded move stamps the log's counts on the state it saves (#3286).
      if (!winRecordedRef.current) {
        guardRecording(() => {
          const tuple = moveTuple(direction, moved);
          if (tuple) moveLog.push(tuple);
          moved = withRecorded(moved, moveLog);
        });
      }
      // `currentState` is the rendered board: if the player left or came
      // back since, its clock doesn't match, so match it (#2750).
      const next = matchPresence(moved);
      setState(next);
      // Only tiles produced by a move made in this session are announced; a
      // restored or resumed board keeps stale isMerge flags (#2222).
      lastMoveTilesRef.current = next.tiles;
      moveCountRef.current += 1;
      syncMarkStarted();
      // The first win per session finishes it.
      const justWon = next.has_won && !winRecordedRef.current;
      if (justWon) winRecordedRef.current = true;
      // Reaching 2048 is the win, even on the move that ends the game; a game
      // over after it (Keep Playing) has no session left to finish.
      if (justWon) finishSession(next, "win");
      else if (next.game_over && !next.has_won) finishSession(next, "loss");
      // The card shows the win even when this move also left no moves.
      if (justWon && next.game_over) setWonOnLastMove(true);
      // The card waits for the beat: the 2048 tile forming, or the stuck board dimming. Set in
      // this same handler as `setState(next)`, so the board and the hold render together.
      if (justWon) startBeat("win");
      else if (next.game_over) startBeat("gameOver");
      // Hold the lock for the slide animation duration, then fire the next queued move.
      lockTimerRef.current = setTimeout(() => {
        lockTimerRef.current = null;
        movingRef.current = false;
        // Moves queued during the winning move would play behind the win
        // card (handleMove's guard only sees moves made after it shows): drop
        // them. Those queued before the player left are dropped too (#2735,
        // #2750): another screen covers the board or the app is in the
        // background by the time this fires, and applying one would restart
        // the paused clock.
        if (justWon || awayRef.current) {
          moveQueue.clear();
          return;
        }
        // The committed board, read when the lock ends. The move runs here, not inside a
        // `setState` updater: an updater must be pure (React may call it twice) and this move
        // records and saves.
        const queued = moveQueue.shift();
        if (!queued) return;
        const latest = stateRef.current;
        if (!latest || latest.game_over) {
          moveQueue.clear();
          return;
        }
        executeMove(queued, latest);
      }, MOVE_LOCK_MS);
    },
    [
      finishSession,
      moveLog,
      moveQueue,
      syncMarkStarted,
      awayRef,
      matchPresence,
      setState,
      startBeat,
      stateRef,
    ]
  );

  const handleMove = useCallback(
    (direction: Direction) => {
      // Any swipe, or arrow key, ends the hint (#3688).
      hideHint();
      hideNoHint();
      if (!state || state.game_over) return;
      // The win card is up: no moves behind it until Keep Playing / Play Again
      // (on web the keyboard would otherwise keep playing under the card).
      if (state.has_won && !winDismissed) return;
      if (movingRef.current) {
        // Kept for after the slide; a third quick swipe is dropped.
        moveQueue.push(direction);
        return;
      }
      executeMove(direction, state);
    },
    [state, winDismissed, executeMove, hideHint, hideNoHint, moveQueue]
  );

  const resetGame = useCallback(() => {
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    lockTimerRef.current = null;
    movingRef.current = false;
    lastMoveTilesRef.current = null;
    moveQueue.clear();
    clearBeat();
    winRecordedRef.current = false;
    hideHint();
    hideNoHint();
    resetGameOver();
    setWinDismissed(false);
    setWonOnLastMove(false);
    setBestAtGameStart((prevBest) => Math.max(prevBest, stateRef.current?.score ?? 0));
    resetLeaderboard();
    const next = newGame();
    // syncStart closes the open session first, if any: abandoned with the
    // progress snapshot when the player moved, discarded when they never did.
    // A game over or the 2048 win already finished it (#2631). It runs before
    // moveCountRef resets, so the snapshot still counts the old game's moves
    // (stateRef still holds the old board until the next render).
    // The old game's last chunk goes to the recorder first, so `start` saves it to that game.
    // The new game's log counts from 0.
    flushMoves();
    moveLog.reset();
    syncStart({ initial_board: flattenBoard(next.board) });
    setState(next);
    moveCountRef.current = 0;
  }, [
    syncStart,
    flushMoves,
    moveLog,
    resetLeaderboard,
    resetGameOver,
    stateRef,
    setState,
    hideHint,
    hideNoHint,
    moveQueue,
    clearBeat,
  ]);

  const handleNewGamePress = useCallback(() => {
    // Only a game still in progress is lost: after the 2048 win its session
    // is already recorded, and after a game over there is nothing to lose.
    if (state && state.score > 0 && !state.game_over && !state.has_won) {
      setConfirmNewGameVisible(true);
    } else {
      resetGame();
    }
  }, [state, resetGame]);

  const handleConfirmNewGame = useCallback(() => {
    setConfirmNewGameVisible(false);
    resetGame();
  }, [resetGame]);

  // Web keyboard controls — arrow keys + WASD.
  useEffect(() => {
    if (Platform.OS !== "web") return;
    const keyMap: Record<string, Direction> = {
      ArrowUp: "up",
      ArrowDown: "down",
      ArrowLeft: "left",
      ArrowRight: "right",
      w: "up",
      W: "up",
      s: "down",
      S: "down",
      a: "left",
      A: "left",
      d: "right",
      D: "right",
    };
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) {
          return;
        }
      }
      const direction = keyMap[e.key];
      if (!direction) return;
      e.preventDefault();
      handleMove(direction);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handleMove]);

  // A swipe is a move the moment the finger has travelled the threshold, once per gesture (#3689),
  // not when it lifts. The gesture is built once and calls the latest handler, so a move landing
  // mid-drag doesn't rebuild it.
  const [swipeTracker] = useState(createSwipeTracker);
  const handleMoveRef = useRef(handleMove);
  useLayoutEffect(() => {
    handleMoveRef.current = handleMove;
  }, [handleMove]);
  const swipeGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(SWIPE_THRESHOLD_PX)
        .onBegin(() => swipeTracker.reset())
        .onUpdate((e) => {
          const direction = swipeTracker.update(e.translationX, e.translationY);
          if (direction) handleMoveRef.current(direction);
        })
        .onFinalize(() => swipeTracker.reset())
        .runOnJS(true),
    [swipeTracker]
  );

  // The session already finished at the win: Keep Playing only hides the
  // card, and the rest of the game is untracked (#2631).
  const handleKeepPlaying = useCallback(() => setWinDismissed(true), []);

  // The win card, until Keep Playing. When the 2048 move also left no moves,
  // it is still the win card, just without Keep Playing (#2631).
  // Both cards wait for the end-of-game beat (`beat`, #3689); a game restored finished has none.
  const winCard = !!state?.has_won && !winDismissed && (!state.game_over || wonOnLastMove);
  const showWinOverlay = winCard && !beat;
  const showGameOverOverlay = !!state?.game_over && !winCard && !beat;
  const canKeepPlaying = showWinOverlay && !state?.game_over;

  // Hint: the engine picks the swipe (the one that merges the most); a stuck board has none.
  const handleHint = useCallback(() => {
    // Mid-move (a slide or a queued swipe still to apply), the board is about to change: a
    // suggestion now would be for the wrong board (#3715 review).
    if (!state || movingRef.current) return;
    const direction = suggestMove(state.board);
    if (!direction) {
      hideHint();
      showNoHint();
      return;
    }
    hideNoHint();
    setHintDirection(direction);
    showHint();
    AccessibilityInfo.announceForAccessibility(
      t("twenty48:a11y.hint", { move: hintText(t, direction, false) })
    );
  }, [state, showHint, hideHint, showNoHint, hideNoHint, t]);
  const hintDisabled = !state || winCard || state.game_over;

  return (
    <GameShell
      gameType="twenty48"
      title={t("game.title")}
      requireBack
      onNewGame={resetGame}
      onOpenLeaderboard={openLeaderboard}
      loading={!state && loading}
      gutter={16}
      style={{ paddingBottom: 16 }}
    >
      {/* The whole play area takes swipes (#3688), not just the board. */}
      <GestureDetector gesture={swipeGesture}>
        <View style={styles.playArea} testID="twenty48-play-area">
          {/* One slim row: Score, Best, Highest Tile, Time. */}
          {state && (
            <View style={styles.statsRow}>
              <ScoreBoard score={state.score} bestScore={bestScore} scoreDelta={state.scoreDelta} />
              <StatsBento state={state} />
            </View>
          )}

          {/* The board, centred in the free height. */}
          <View style={styles.boardArea} onLayout={onBoardAreaLayout} testID="twenty48-board-area">
            {noHintVisible && (
              <Text
                style={[styles.noHintToast, { color: colors.accent }]}
                accessibilityLiveRegion="polite"
                testID="twenty48-no-hint-toast"
              >
                {t("twenty48:action.noHint")}
              </Text>
            )}
            <View testID="twenty48-board" style={styles.boardContainer}>
              {state && (
                <Grid
                  tiles={state.tiles}
                  beat={beat}
                  maxSize={
                    // A first or transient layout can measure ~0: use the width cap until the
                    // area is a usable height, never a zero or negative board (#3715 review).
                    boardAreaHeight === null || boardAreaHeight - 2 * BOARD_V_MARGIN < MIN_BOARD
                      ? undefined
                      : boardAreaHeight - 2 * BOARD_V_MARGIN
                  }
                />
              )}
              {hintVisible && hintDirection && (
                <HintOverlay direction={hintDirection} showKey={Platform.OS === "web"} />
              )}
            </View>
          </View>

          {/* Hint and New Game, in thumb reach under the board (shared with Mahjong). */}
          <GameActionBar
            testID="twenty48-action-bar"
            height={ACTION_BAR_H}
            actions={[
              {
                key: "hint",
                icon: "lightbulb",
                label: t("twenty48:action.hint"),
                accessibilityLabel: t("twenty48:action.hintLabel"),
                color: colors.bonus,
                disabled: hintDisabled,
                onPress: handleHint,
                testID: "twenty48-hint-button",
              },
              {
                key: "newGame",
                icon: "refresh",
                label: t("twenty48:actions.newGame"),
                accessibilityLabel: t("twenty48:actions.newGameLabel"),
                color: colors.accent,
                onPress: handleNewGamePress,
                testID: "twenty48-new-game-button",
              },
            ]}
          />
        </View>
      </GestureDetector>

      {/* End-of-game result card (#2513): the 2048 win (Keep Playing) or no moves. */}
      <GameResultModal
        // Remount on a win → game-over switch so the new outcome is announced.
        key={showGameOverOverlay ? "game-over" : "win"}
        visible={showWinOverlay || showGameOverOverlay}
        outcome={showGameOverOverlay ? "ended" : "win"}
        eyebrow={t("twenty48:game.title")}
        subtitle={canKeepPlaying ? t("twenty48:win.body") : tResult("subtitle.noMoves")}
        hero={{ kind: "score", label: tResult("stat.score"), value: state?.score ?? 0 }}
        isNewBest={
          !!state?.game_over && bestOf(bestAtGameStart, state?.score ?? 0, false).isNewBest
        }
        stats={
          state
            ? [
                { label: t("twenty48:score.best"), value: Math.max(bestScore, state.score) },
                { label: t("twenty48:stats.highestTile"), value: highestTile(state.board) },
              ]
            : []
        }
        primaryAction={
          canKeepPlaying
            ? {
                label: t("twenty48:actions.keepPlaying"),
                accessibilityLabel: t("twenty48:actions.keepPlayingLabel"),
                onPress: handleKeepPlaying,
              }
            : undefined
        }
        onPlayAgain={resetGame}
        secondaryAction={
          canKeepPlaying ? { label: tResult("action.playAgain"), onPress: resetGame } : undefined
        }
        // The session's leaderboard line. A game over after Keep Playing is
        // untracked, so its card has none.
        submission={winDismissed ? undefined : toSubmission(leaderboard)}
        onViewLeaderboard={openLeaderboard}
        onHome={() => navigation.popToTop()}
        testID="twenty48-result"
      />

      <NewGameConfirmModal
        visible={confirmNewGameVisible}
        onConfirm={handleConfirmNewGame}
        onCancel={() => setConfirmNewGameVisible(false)}
      />
    </GameShell>
  );
}

const styles = StyleSheet.create({
  playArea: {
    flex: 1,
    alignSelf: "stretch",
  },
  statsRow: {
    flexDirection: "row",
    gap: 8,
    alignSelf: "center",
    width: "100%",
    maxWidth: 360,
    marginTop: 8,
  },
  boardArea: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  boardContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
  },
  noHintToast: {
    // Over the board area and never takes a touch meant for the swipe under it.
    position: "absolute",
    pointerEvents: "none",
    top: 4,
    zIndex: 3,
    fontFamily: typography.heading,
    fontSize: 13,
    letterSpacing: 0.5,
  },
});
