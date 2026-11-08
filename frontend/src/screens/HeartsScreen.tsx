/**
 * HeartsScreen — four-player Hearts against three computer players.
 *
 * Concerns:
 *   1. Game logic — the pure engine plus the AI (`game/hearts/ai`); `runAiTurns` paces the
 *      computer seats; the opponent style opens on the last one played (#1129).
 *   2. Persistence — `saveGame` on trick and hand transitions, on blur and on background.
 *   3. Play clock (#2629) — its own clock, sent as the game's durationMs: `usePauseWhileAway`
 *      pauses it on blur and background and resumes it once both end; its `onLeave` saves the
 *      game on the move to background (#3087).
 *   4. Instrumentation — `useGameRecorder("hearts")` (useGameSync + the shared recorder);
 *      the result records who won (#2517) and the per-hand scores (#2838); a restored game
 *      resumes its session (#2654). The deals, passes, tricks and hand scores of all four
 *      seats are recorded for replay through `HeartsReplay` (#3283, docs/games/hearts.md).
 *   5. Result + leaderboard (#2506, #2633) — the shared GameResultModal with the final
 *      standings, ranked via `useGameLeaderboard`.
 *   6. Events and scorecard — `useGameEvents` drives the hearts-broken, moon-shot and queen
 *      animations; the rounds context feeds the live ScorecardScreen.
 *   7. Debug panel — HeartsDebugPanel, required lazily in dev and pre-launch builds (#2970);
 *      its in-memory hand log is separate from the replay events, which every build records.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type LayoutChangeEvent,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { useFocusEffect, useNavigation } from "@react-navigation/native";
import { usePauseWhileAway } from "../hooks/usePauseWhileAway";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { HomeStackParamList } from "../types/navigation";
import { useTranslation } from "react-i18next";
import { useTheme } from "../theme/ThemeContext";
import { GameShell } from "../components/shared/GameShell";
import { useGameLeaderboard } from "../game/_shared/useGameLeaderboard";
import { ModalCard } from "../components/shared/ModalCard";
import {
  OpponentCapturedPile,
  SelfCapturedPile,
  penaltyPoints,
} from "../components/hearts/CapturedPile";
import SeatPlate from "../components/hearts/SeatPlate";
import {
  COUNTER_MIN_BANNER_H,
  NARROW_BANNER_WIDTH,
  computeFallbackGeometry,
  computeHeartsGeometry,
  type HeartsTableGeometry,
  type SeatPosition,
  type TrickPosition,
} from "../game/hearts/layout";
import { HEARTS_FELT_CENTRE, HEARTS_FELT_EDGE, HEARTS_FELT_BORDER } from "../theme/theme.hearts";
import OpponentHand from "../components/hearts/OpponentHand";
import PassBanner from "../components/hearts/PassBanner";
import PlayerHand from "../components/hearts/PlayerHand";
import HeartsScorecard from "../components/scorecard/HeartsScorecard";
import TrickArea from "../components/hearts/TrickArea";
import {
  commitPass,
  dealGame,
  dealNextHand,
  detectMoon,
  getValidPlays,
  isQueenOfSpades,
  playCard,
  selectPassCard,
} from "../game/hearts/engine";
import { explainCardToPlay, explainCardsToPass } from "../game/hearts/ai";
import HeartsAiDifficultySelector from "../components/hearts/HeartsAiDifficultySelector";
import {
  clearGame,
  loadFinishedGameId,
  loadGame,
  saveFinishedGameId,
  saveGame,
} from "../game/hearts/storage";
import {
  DEFAULT_NAMES,
  loadPlayerNames,
  savePlayerNames,
  validateName,
} from "../game/hearts/playerNames";
import { buildHeartsCompletedResult, heartsResult } from "../game/hearts/result";
import {
  clockMs,
  pauseClock,
  pausedClock,
  runClock,
  withPlayTime,
  type PlayClock,
} from "../game/hearts/clock";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import HeartsFinalStandings from "../components/hearts/HeartsFinalStandings";
import GameResultModal from "../components/shared/GameResultModal";
import { toSubmission } from "../components/shared/toSubmission";
import { useLastDifficulty } from "../game/_shared/lastDifficulty";
import { useHeartsRounds } from "../game/hearts/RoundsContext";
import { createIntegrityReporter } from "../game/hearts/integrity";
import { useGameRecorder } from "../game/_shared/useGameRecorder";
import { BLUR_MIN_TRICKS, HeartsReplay, gameStartedData } from "../game/hearts/replay";
import { loadPendingReplay, pendingReplayPort } from "../game/hearts/pendingReplay";
import type { PrincipleId } from "../game/hearts/conservative/terms";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useSound } from "../game/_shared/useSound";
import { useSoundVariants } from "../game/_shared/useSoundVariants";
import { HEARTS_CARD_PLAY, HEARTS_SOUNDS, HEARTS_TRICK_WON } from "../game/hearts/sounds";
import { HeartsBrokenAnimation } from "../components/hearts/HeartsBrokenAnimation";
import { HeartsMoonShotAnimation } from "../components/hearts/HeartsMoonShotAnimation";
import {
  HeartsQueenOfSpadesAnimation,
  type QueenCardRect,
} from "../components/hearts/HeartsQueenOfSpadesAnimation";
import { createMomentHold } from "../game/hearts/momentHold";
import { BROKEN_TIMING } from "../components/hearts/momentTimeline";
import type { AiPreset, Card, HeartsState, TrickCard } from "../game/hearts/types";
import {
  DEFAULT_AI_PRESET,
  HEARTS_OPPONENT_PICKER_ENABLED,
  resolveAvailablePreset,
  resolvePersona,
  selectablePresets,
} from "../game/hearts/types";
import { areLegacyHeartsPersonasEnabled } from "../game/_shared/envFlags";
import type {
  HandDebugLog,
  DebugTrick,
  DebugPlay,
  DebugPassCard,
  LiveDecisions,
} from "../game/hearts/debugLog";
type HeartsDebugPanelType = typeof import("../components/hearts/HeartsDebugPanel").default;
import { isPreLaunchApiBuild } from "../game/_shared/envFlags";

const HUMAN = 0;

/** Seat index to its place at the table, relative to the human (West is seat 1, North 2, East 3). */
const SEAT_POSITIONS: readonly { seat: number; position: SeatPosition }[] = [
  { seat: 0, position: "self" },
  { seat: 1, position: "left" },
  { seat: 2, position: "top" },
  { seat: 3, position: "right" },
];

const TRICK_POSITION: Record<SeatPosition, TrickPosition> = {
  self: "bottom",
  left: "left",
  top: "top",
  right: "right",
};

/** Where a seat's card lies in the trick, in the table's coordinates (the Q♠ moment lifts it). */
function trickCardRect(g: HeartsTableGeometry, seat: number): QueenCardRect {
  const position = SEAT_POSITIONS.find((p) => p.seat === seat)?.position ?? "self";
  const slot = g.trick.slots[TRICK_POSITION[position]];
  return {
    x: g.trick.area.x + slot.x,
    y: g.trick.area.y + slot.y,
    w: g.trick.cardW,
    h: g.trick.cardH,
    rotation: slot.rotation,
  };
}

// Dev / pre-launch only: required lazily so the debug panel (and the PIMC
// benchmark it pulls in) is not evaluated in release builds (#2970; pattern:
// yacht/oracle/oracle.ts).
function loadHeartsDebugPanel(): HeartsDebugPanelType {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy require is the point: defer eval of pimc/* until the debug panel is actually shown
  return (require("../components/hearts/HeartsDebugPanel") as { default: HeartsDebugPanelType })
    .default;
}

/**
 * Dev bundles and internal test (pre-launch API) builds, never store builds: the
 * debug panel opens, and its in-memory hand log (with each CPU play's position and
 * reason) is recorded, only here. The replay events (#3283) are recorded in every
 * build. Read at each use so a test can flip the build flags.
 */
function debugEnabled(): boolean {
  return __DEV__ || isPreLaunchApiBuild();
}

/**
 * The longest the hearts-broken moment may hold its trick's sweep: its full run plus a margin.
 * Its onAnimationEnd normally lets go first (1.7 s, or the still caption's 1 s with Reduce
 * Motion); this only stops a trick staying on the table if that never reports.
 */
const BROKEN_HOLD_LIMIT_MS = BROKEN_TIMING.end + 500;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A completed trick for the debug log, each play carrying its CPU note (#3163) when it has one. */
function buildDebugTrick(
  rawPlays: readonly TrickCard[],
  winnerIndex: number,
  notes: readonly DebugPlay[] = []
): DebugTrick {
  const plays: DebugPlay[] = rawPlays.map(
    (p) =>
      notes.find(
        (n) =>
          n.playerIndex === p.playerIndex &&
          n.card.suit === p.card.suit &&
          n.card.rank === p.card.rank
      ) ?? p
  );
  const pointsWon = plays.reduce((sum, tc) => {
    if (tc.card.suit === "hearts") return sum + 1;
    if (isQueenOfSpades(tc.card)) return sum + 13;
    return sum;
  }, 0);
  return { plays, winnerIndex, pointsWon };
}

/** An abandoned game's result block: the hands it got through. */
function progressResult(s: HeartsState): Record<string, unknown> {
  return { hands_played: s.scoreHistory.length };
}

type LastTrick = { readonly trick: readonly TrickCard[]; readonly winnerIndex: number } | null;

export default function HeartsScreen() {
  const { t } = useTranslation("hearts");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  // The card's rank line, "View leaderboard" link and ⋯ menu item (#2633).
  const { leaderboard, openLeaderboard } = useGameLeaderboard("hearts", navigation);
  const { lookup: lookupRank, reset: resetSubmission } = leaderboard;

  // Legacy personas (and the picker) exist only in dev / pre-launch builds (#3158).
  const legacyPersonas = areLegacyHeartsPersonasEnabled();
  const [gameState, setGameState] = useState<HeartsState | null>(null);
  // The saved-game check has finished. Without the picker the table is dealt only then, so no
  // pre-game screen flashes while it runs (#3489).
  const [resumeChecked, setResumeChecked] = useState(false);
  // Opens on the opponent style of the last game started (#1129).
  const {
    difficulty: selectedDifficulty,
    setDifficulty: setSelectedDifficulty,
    rememberDifficulty,
  } = useLastDifficulty<AiPreset>("hearts", selectablePresets(legacyPersonas), DEFAULT_AI_PRESET);
  const [lastTrick, setLastTrick] = useState<LastTrick>(null);
  // The hearts-broken moment (#3588). While it shows, the trick with the breaking heart stays
  // on the table (its sweep waits); the CPU players do not wait for it.
  const [showHeartsBroken, setShowHeartsBroken] = useState(false);
  useEffect(() => {
    if (!showHeartsBroken) return;
    const timer = setTimeout(() => setShowHeartsBroken(false), BROKEN_HOLD_LIMIT_MS);
    return () => clearTimeout(timer);
  }, [showHeartsBroken]);
  // The moon shot moment and who shot it (#3588). Hand Complete waits for it to end (#3586).
  const [showMoonShot, setShowMoonShot] = useState(false);
  const [moonShotSeat, setMoonShotSeat] = useState(HUMAN);
  // A moon shot clinched by the trick the Q♠ was played to waits for the queen's moment.
  const [queuedMoonShotSeat, setQueuedMoonShotSeat] = useState<number | null>(null);
  // The Queen of Spades moment (#3588) and the seat that played the Q♠.
  const [showQueenOfSpades, setShowQueenOfSpades] = useState(false);
  const [queenSeat, setQueenSeat] = useState(HUMAN);
  // The CPU players wait while the queen's or a moon shot's moment holds the table (#3588).
  const momentHold = useMemo(() => createMomentHold(), []);
  const [showRename, setShowRename] = useState(false);
  // The seat whose captured cards are open (tapped plate), or null.
  const [pileSeat, setPileSeat] = useState<number | null>(null);
  // The pile is only for the hand in play: when the phase leaves "playing" (hand over, game over,
  // a new deal) it closes, so it never sits under the Hand Complete or result card, or shows
  // the last hand's cards.
  const phase = gameState?.phase;
  useEffect(() => {
    if (phase !== "playing") setPileSeat(null);
  }, [phase]);
  // The table's measured area; until it is measured, the window less the header and tab bar.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [tableSize, setTableSize] = useState<{ width: number; height: number } | null>(null);
  const handleTableLayout = useCallback((e: LayoutChangeEvent) => {
    const { width, height } = e.nativeEvent.layout;
    setTableSize((prev) =>
      prev && prev.width === width && prev.height === height ? prev : { width, height }
    );
  }, []);
  const geometry = useMemo(
    () =>
      tableSize
        ? computeHeartsGeometry(tableSize)
        : computeFallbackGeometry({ width: windowWidth, height: windowHeight }),
    [tableSize, windowWidth, windowHeight]
  );
  const [playerNames, setPlayerNames] = useState<string[]>([...DEFAULT_NAMES]);
  const [draftNames, setDraftNames] = useState<string[]>([...DEFAULT_NAMES]);
  // What the rename form was seeded with, per seat: whether the stored name was the
  // English default, and the label shown. A seat goes back to the stored default only if
  // it was one and is still exactly that label (#2221).
  const draftSeedRef = useRef<{ wasDefault: boolean[]; labels: string[] }>({
    wasDefault: [],
    labels: [],
  });
  // Stored names keep the English defaults (persisted + compared); the default
  // seats are translated at render time, custom names are shown as typed (#2221).
  const seatDefaults = useMemo(() => DEFAULT_NAMES.map((_, i) => t(`seat.${i}`)), [t]);
  const playerLabels = useMemo(
    () => playerNames.map((n, i) => (n === DEFAULT_NAMES[i] ? (seatDefaults[i] ?? n) : n)),
    [playerNames, seatDefaults]
  );

  // scoreHistory now lives on HeartsState (engine-authoritative, persisted).
  const scoreHistory = useMemo(() => gameState?.scoreHistory ?? [], [gameState?.scoreHistory]);

  // ── Debug mode (__DEV__ only) ──────────────────────────────────────────────
  const debugMode = __DEV__;
  // The debug panel also opens in internal test builds (never store builds),
  // for its on-device PIMC timing (#2587), and the hand logs and CPU principles
  // are recorded there too (#3163); card reveals stay __DEV__-only.
  const showDebugPanel = debugEnabled();
  const [DebugPanel] = useState(() => (showDebugPanel ? loadHeartsDebugPanel() : null));
  const [debugPanelOpen, setDebugPanelOpen] = useState(false);
  const [handNotes, setHandNotes] = useState<string[]>([]);
  const [handLogs, setHandLogs] = useState<HandDebugLog[]>([]);
  const dealSnapshotRef = useRef<{
    initialHands: readonly (readonly Card[])[];
    passSelections: readonly (readonly Card[])[];
    finalHands: readonly (readonly Card[])[];
    passDecisions?: readonly (readonly DebugPassCard[])[];
  } | null>(null);
  const trickLogBufferRef = useRef<DebugTrick[]>([]);
  // Conservative-CPU plays of the trick in progress, with the principle behind each (#3163).
  const cpuPlayNotesRef = useRef<DebugPlay[]>([]);

  const unmountedRef = useRef(false);
  const loopActiveRef = useRef(false);
  const gameStateRef = useRef<HeartsState | null>(gameState);
  const trickAnimResolverRef = useRef<(() => void) | null>(null);
  const humanJustPlayedQSRef = useRef(false);
  const gameOverFiredRef = useRef(false);
  // The play clock (#2629): active play time, sent as the game's durationMs.
  // It runs while an unfinished game is on screen with the app in front.
  const clockRef = useRef<PlayClock>(pausedClock());
  const reportIntegrity = useMemo(() => createIntegrityReporter(), []);

  // On unmount this cleanup runs before the recorder's own (cleanups run in
  // declaration order): the units still waiting reach the recorder, which saves
  // the session ahead of the abandon's game_ended (#3283).
  const flushReplayRef = useRef<() => void>(() => undefined);
  useEffect(() => () => flushReplayRef.current(), []);

  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    close: syncClose,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
    beginUnit: recorderBeginUnit,
    record: recorderRecord,
    closeUnit: recorderCloseUnit,
    flush: recorderFlush,
  } = useGameRecorder("hearts");

  // The replay events (#3283): built in memory, handed to the recorder a unit at
  // a time (a trick after its collect animation), saved off the interaction path.
  const replay = useMemo(
    () =>
      new HeartsReplay(
        {
          isOpen: () => syncGetGameId() !== null,
          beginUnit: recorderBeginUnit,
          record: recorderRecord,
          closeUnit: recorderCloseUnit,
          flush: recorderFlush,
        },
        pendingReplayPort
      ),
    [syncGetGameId, recorderBeginUnit, recorderRecord, recorderCloseUnit, recorderFlush]
  );
  useEffect(() => {
    flushReplayRef.current = () => replay.flush({ force: true });
  }, [replay]);

  /** Saves the game with its play time so far. */
  const persist = useCallback((s: HeartsState) => saveGame(withPlayTime(s, clockRef.current)), []);

  /** Runs the clock while `s` is unfinished and the player is here; else pauses it. */
  const setClockFor = useCallback((s: HeartsState | null, away: boolean) => {
    const running = !!s && !s.isComplete && s.phase !== "game_over" && !away;
    clockRef.current = running ? runClock(clockRef.current) : pauseClock(clockRef.current);
  }, []);

  // ─── Play clock: time away is not play time (#2629) ───────────────────────
  // The player is away while another screen covers this one or the app is not
  // in front (iOS passes through "inactive" on the way out, and for the
  // control centre): the clock pauses, and runs again once both have ended.
  // The game is saved with its play time once, on the move to "background",
  // so a game killed there keeps it.
  const awayRef = usePauseWhileAway(
    navigation,
    () => setClockFor(gameStateRef.current, true),
    () => setClockFor(gameStateRef.current, false),
    {
      onLeave: (event) => {
        if (event.reason !== "appState" || event.status !== "background") return;
        if (event.previous === "background") return;
        // Saved now, not at the next idle moment: the app may be killed while away.
        replay.flush();
        const gs = gameStateRef.current;
        if (gs && !gs.isComplete) void persist(gs);
      },
    }
  );

  /** `setClockFor` with whether the player is away now. */
  const updateClock = useCallback(
    (s: HeartsState | null) => setClockFor(s, awayRef.current),
    [setClockFor, awayRef]
  );

  // The hook abandons a started session itself (unmount, and New Game /
  // Change Difficulty through close()); the abandon carries how many hands
  // were played and the play time (#2629). No score: an abandon never ranks.
  useEffect(() => {
    syncSetProgressSnapshot(() => {
      const s = gameStateRef.current;
      return s ? { result: progressResult(s), durationMs: clockMs(clockRef.current) } : {};
    });
  }, [syncSetProgressSnapshot]);

  // Bumped when the player leaves this game for another (New Game, Change
  // Difficulty): a slow read for the old game must not act on the new one.
  const gameGenerationRef = useRef(0);

  // Keep ref in sync for use in event listeners.
  useEffect(() => {
    gameStateRef.current = gameState;
  });

  useEffect(
    () => () => {
      unmountedRef.current = true;
      // A loop waiting on a moment wakes, sees the unmount and stops.
      momentHold.release();
      const resolve = trickAnimResolverRef.current;
      trickAnimResolverRef.current = null;
      if (resolve) resolve();
    },
    [momentHold]
  );

  // ─── Load saved game and player names on mount ────────────────────────────
  useEffect(() => {
    loadGame().then((saved) => {
      if (!unmountedRef.current) setResumeChecked(true);
      if (!unmountedRef.current && saved) {
        // A finished game resumed from storage: its game-over sound played when
        // it ended, and its row synced itself. The card asks for its rank again
        // (or for the display name it still lacks) — nothing is submitted.
        if (saved.phase === "game_over") {
          gameOverFiredRef.current = true;
          const generation = gameGenerationRef.current;
          loadFinishedGameId().then((gameId) => {
            // Not once the player has moved on to another game.
            if (unmountedRef.current || generation !== gameGenerationRef.current) return;
            if (gameId) void lookupRank(gameId);
          });
        }
        // The play time lives in the clock, not in the state (#2629).
        const { accumulatedMs, ...loaded } = saved;
        // A legacy persona the flag does not offer plays on as Conservative (#3158).
        // loadGame already does this; repeating it here is idempotent and keeps
        // the screen correct whatever loader it is given.
        const state = {
          ...loaded,
          aiDifficulty: resolveAvailablePreset(loaded.aiDifficulty, legacyPersonas),
          // Their sounds and moments played before the game was saved: none replays (#3588).
          events: [] as HeartsState["events"],
        };
        // A restored game continues the session a killed app left open (#2654).
        const resumed = state.phase !== "game_over" && syncResume();
        // The saved play time belongs to that session: kept only when it is
        // continued. Otherwise (it was abandoned when the screen was left) the
        // next session starts from 0, so no minute is counted twice. Either
        // way the clock runs again from now: time away is not play.
        clockRef.current = pausedClock(resumed ? accumulatedMs : 0);
        updateClock(state);
        setGameState(state);
        setSelectedDifficulty(state.aiDifficulty);
        // A deal and pass kept by a killed process that no game session had yet (#3283).
        if (state.phase !== "game_over") {
          // Not into a game the player has started since (New Game while this was loading).
          const generation = gameGenerationRef.current;
          void loadPendingReplay().then((units) => {
            if (unmountedRef.current || generation !== gameGenerationRef.current) return;
            replay.restore(units, state.handNumber, resumed);
          });
        }
        if (debugEnabled() && (saved.phase === "playing" || saved.phase === "passing")) {
          // Best-effort: saved state doesn't preserve the original deal, so
          // playerHands approximates both initial and final hands for resumed games.
          dealSnapshotRef.current = {
            initialHands: saved.playerHands,
            passSelections: saved.passSelections ?? [[], [], [], []],
            finalHands: saved.playerHands,
          };
        }
      }
    });
    loadPlayerNames().then((names) => {
      if (!unmountedRef.current) {
        setPlayerNames(names);
        setDraftNames(names);
      }
    });
  }, [syncResume, setSelectedDifficulty, lookupRank, updateClock, legacyPersonas, replay]);

  // ─── No picker: deal a Conservative game when there is nothing to resume (#3489) ───
  useEffect(() => {
    if (HEARTS_OPPONENT_PICKER_ENABLED || !resumeChecked || gameState) return;
    handleStartGame(DEFAULT_AI_PRESET);
    // Once the saved-game check is done; New Game deals its own game.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeChecked]);

  // ─── Sync snapshot to shared rounds context (read by ScorecardScreen) ────
  const { setSnapshot: setRoundsSnapshot } = useHeartsRounds();
  useEffect(() => {
    setRoundsSnapshot({
      cumulativeScores: gameState?.cumulativeScores ?? [0, 0, 0, 0],
      scoreHistory,
      playerLabels,
    });
  }, [gameState?.cumulativeScores, scoreHistory, playerLabels, setRoundsSnapshot]);

  // ─── Run integrity validators (Sentry-warns on impossible state) ──────────
  useEffect(() => {
    if (gameState) reportIntegrity(gameState);
  }, [gameState, reportIntegrity]);

  // ─── Commit hand log entry when a hand ends ───────────────────────────────
  useEffect(() => {
    if (!debugEnabled()) return;
    if (!gameState) return;
    if (gameState.phase !== "dealing" && gameState.phase !== "game_over") return;
    const snapshot = dealSnapshotRef.current;
    if (!snapshot) return;
    const histLen = gameState.scoreHistory.length;
    if (histLen === 0) return;
    const entry: HandDebugLog = {
      handNumber: gameState.handNumber,
      passDirection: gameState.passDirection,
      initialHands: snapshot.initialHands,
      passSelections: snapshot.passSelections,
      ...(snapshot.passDecisions ? { passDecisions: snapshot.passDecisions } : {}),
      finalHands: snapshot.finalHands,
      tricks: [...trickLogBufferRef.current],
      scoreDeltas: gameState.scoreHistory[histLen - 1] ?? [],
      cumulativeScoresAfter: gameState.cumulativeScores,
    };
    setHandLogs((prev) => [...prev, entry]);
    setHandNotes((prev) => [...prev, ""]);
    trickLogBufferRef.current = [];
    cpuPlayNotesRef.current = [];
    dealSnapshotRef.current = null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase]);

  // ─── Save on blur ─────────────────────────────────────────────────────────
  // Tab switches unmount the Lobby HomeStack; without this, mid-trick or
  // pass-phase state is lost (saveGame elsewhere only fires on trick complete
  // and hand transitions). Persisting on blur keeps full game continuity.
  // (The play clock's pause on blur is usePauseWhileAway's, above.)
  useFocusEffect(
    useCallback(
      () => () => {
        const gs = gameStateRef.current;
        if (!gs || gs.isComplete) return;
        // Only a few tricks' worth: opening the scorecard each trick must not make a row each time.
        replay.flush({ minTricks: BLUR_MIN_TRICKS });
        void persist(gs);
      },
      [persist, replay]
    )
  );

  const { play: playHeartsBroken } = useSound("hearts.heartsBroken", HEARTS_SOUNDS);
  const { play: playMoonShot } = useSound("hearts.moonShot", HEARTS_SOUNDS);
  const { play: playQueenOfSpades } = useSound("hearts.queenOfSpades", HEARTS_SOUNDS);
  const { play: playCardPlay } = useSoundVariants(HEARTS_CARD_PLAY, HEARTS_SOUNDS);
  const { play: playTrickWon } = useSoundVariants(HEARTS_TRICK_WON, HEARTS_SOUNDS);
  const { play: playGameWon } = useSound("hearts.gameWon", HEARTS_SOUNDS);
  const { play: playGameLost } = useSound("hearts.gameLost", HEARTS_SOUNDS);

  /** The moon shot moment, with the howl when the human shot it. */
  function startMoonShot(shooter: number) {
    if (shooter === HUMAN) playMoonShot();
    momentHold.hold("moon");
    setMoonShotSeat(shooter);
    setShowMoonShot(true);
  }

  function handleQueenMomentEnd() {
    setShowQueenOfSpades(false);
    // The moon shot the same trick clinched plays now, holding the table before the queen lets go.
    if (queuedMoonShotSeat !== null) {
      setQueuedMoonShotSeat(null);
      startMoonShot(queuedMoonShotSeat);
    }
    momentHold.release("queen");
  }

  function handleMoonMomentEnd() {
    setShowMoonShot(false);
    momentHold.release("moon");
  }

  useGameEvents(
    gameState?.events,
    {
      heartsBroken: () => {
        // During the Queen of Spades' moment hearts break silently: one caption and one
        // sound at a time, and the queen already holds the trick's sweep.
        if (momentHold.isHeld("queen")) return;
        playHeartsBroken();
        setShowHeartsBroken(true);
      },
      moonShot: (event) => {
        if (momentHold.isHeld("queen")) setQueuedMoonShotSeat(event.shooter);
        else startMoonShot(event.shooter);
      },
      queenOfSpadesPlayed: (event) => {
        // The human's own Q♠ already sounded in handleCardPress.
        if (humanJustPlayedQSRef.current) humanJustPlayedQSRef.current = false;
        else playQueenOfSpades();
        momentHold.hold("queen");
        setQueenSeat(event.seat);
        // The queen supersedes a hearts-broken moment still playing: one caption at a time.
        setShowHeartsBroken(false);
        setShowQueenOfSpades(true);
      },
    },
    () => setGameState((prev) => (prev ? { ...prev, events: [] as HeartsState["events"] } : null))
  );

  // ─── Start sync on first card play ────────────────────────────────────────
  function ensureSyncStarted(aiDifficulty: AiPreset) {
    if (syncGetGameId()) return;
    // The opponent style is recorded, not ranked on (#2629).
    // The seats, preset and target score go with the start (#3283).
    syncStart(gameStartedData(aiDifficulty), { ai_difficulty: aiDifficulty });
    syncMarkStarted();
    // The deal and pass were made before the session opened: hand them over now.
    replay.publish();
  }

  // ─── AI turn loop ─────────────────────────────────────────────────────────
  const runAiTurns = useCallback(
    async (initial: HeartsState) => {
      if (loopActiveRef.current) return;
      loopActiveRef.current = true;
      try {
        // Start with a clean events slate; initial events are already in React state
        // and will be processed by useGameEvents independently.
        let s: HeartsState = { ...initial, events: [] };
        while (s.currentPlayerIndex !== HUMAN && s.phase === "playing") {
          const willComplete = s.currentTrick.length === 3;
          await delay(400);
          if (unmountedRef.current) return;

          // Read the latest committed React state after the await. If the game was
          // reset mid-loop (handleStartGame sets loopActiveRef=false and a fresh
          // non-null state), our stale card is no longer in that state's hands —
          // bail rather than throwing "Invalid play" inside the state write.
          // A table-stopping moment (the Queen of Spades, a moon shot) plays out first (#3588).
          await momentHold.settled();
          if (unmountedRef.current) return;

          const latestState = gameStateRef.current;
          if (!latestState || latestState.currentPlayerIndex !== s.currentPlayerIndex) return;

          const playerIndex = s.currentPlayerIndex;
          const persona = resolvePersona(s.aiDifficulty, playerIndex);
          const decision = explainCardToPlay(
            s.playerHands[playerIndex] as Card[],
            s.currentTrick as TrickCard[],
            s,
            playerIndex,
            persona
          );
          const card = decision.card;
          replay.notePlay(playerIndex, decision.principle);
          if (debugEnabled() && persona === "conservative") {
            cpuPlayNotesRef.current.push({
              playerIndex,
              card,
              principle: decision.principle,
              reason: decision.reason,
              position: {
                trickNumber: s.tricksPlayedInHand + 1,
                hand: s.playerHands[playerIndex] ?? [],
                trickSoFar: s.currentTrick,
                heartsBroken: s.heartsBroken,
                points: s.handScores,
              },
            });
          }
          const completedTrick: readonly TrickCard[] | null = willComplete
            ? [...s.currentTrick, { card, playerIndex }]
            : null;

          const before = s;
          s = playCard(s, playerIndex, card);
          // The Q♠ sounds only its gong, from the queenOfSpadesPlayed event (as for the human).
          if (!isQueenOfSpades(card)) playCardPlay();

          if (completedTrick) {
            setLastTrick({ trick: completedTrick, winnerIndex: s.currentLeaderIndex });
            void persist(s);
            // In memory only; the hand's tricks go to the recorder when the hand ends.
            replay.trick(before, completedTrick, s);
            if (debugEnabled()) {
              trickLogBufferRef.current.push(
                buildDebugTrick(completedTrick, s.currentLeaderIndex, cpuPlayNotesRef.current)
              );
              cpuPlayNotesRef.current = [];
            }
          }
          // Apply the card play on top of the latest React state, with events
          // cleared first so prior-turn events don't accumulate in prev and cause
          // useGameEvents to re-fire already-processed handlers (e.g. duplicate
          // heartsBroken animation). The local `s` is still advanced above for the
          // AI's own decision-making in subsequent iterations.
          setGameState(
            playCard({ ...latestState, events: [] as HeartsState["events"] }, playerIndex, card)
          );
          s = { ...s, events: [] };

          if (completedTrick && s.phase === "playing") {
            await new Promise<void>((resolve) => {
              trickAnimResolverRef.current = resolve;
            });
            if (unmountedRef.current) return;
            setLastTrick(null);
          }
        }
      } finally {
        loopActiveRef.current = false;
      }
    },
    [playCardPlay, persist, replay, momentHold]
  );

  // Trigger AI loop when it's their turn; wait for lastTrick display first.
  useEffect(() => {
    if (!gameState) return;
    if (gameState.phase !== "playing") return;
    if (gameState.currentPlayerIndex === HUMAN) return;
    if (lastTrick !== null) return;
    void runAiTurns(gameState);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, gameState?.currentPlayerIndex, gameState?.tricksPlayedInHand, lastTrick]);

  // Complete sync when game is over, then show where the game ranks.
  useEffect(() => {
    if (gameState?.phase !== "game_over") return;
    // The game is over: its clock stops at its play time.
    clockRef.current = pauseClock(clockRef.current);
    // #2517: record who won — the same outcome the result card shows.
    // #2838: with the per-hand scores (post moon adjustment) behind it.
    const result = buildHeartsCompletedResult(
      gameState.cumulativeScores,
      gameState.scoreHistory,
      HUMAN
    );
    const finalScore = result.final_score;
    const outcome = result.vs_result;
    // The play clock's active time (#2629); a 0 goes out as unknown (resolveDurationMs).
    const durationMs = clockMs(clockRef.current);
    const gameId = syncComplete(
      { outcome: recordedOutcome(outcome), finalScore, durationMs, result },
      // The analytics event gets the score only; the per-hand history stays in
      // the completion result, not duplicated into game_events (#2838).
      { final_score: result.final_score, vs_result: result.vs_result }
    );
    if (!gameId) return;
    // Kept beside the saved game-over state, so a reopened card asks again.
    void saveFinishedGameId(gameId);
    void lookupRank(gameId);
  }, [
    gameState?.phase,
    gameState?.cumulativeScores,
    gameState?.scoreHistory,
    syncComplete,
    lookupRank,
  ]);

  // Hand Complete and the result card open, and the game-over sound plays, only after the
  // Queen of Spades' and the moon shot's moments (#3586, #3588), including the render in
  // which the event has arrived but its handler has not run yet.
  const pendingEvents = gameState?.events ?? [];
  const momentPending =
    showMoonShot ||
    showQueenOfSpades ||
    queuedMoonShotSeat !== null ||
    pendingEvents.some((e) => e.type === "moonShot" || e.type === "queenOfSpadesPlayed");

  useEffect(() => {
    if (momentPending) return;
    if (gameState?.phase === "game_over" && !gameOverFiredRef.current) {
      gameOverFiredRef.current = true;
      // Tied for the lowest score counts as won: the player shares the win (#3563).
      if (heartsResult(gameState.cumulativeScores, HUMAN).outcome === "loss") playGameLost();
      else playGameWon();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameState?.phase, momentPending]);

  // ─── Human card play ──────────────────────────────────────────────────────
  function handleCardPress(card: Card) {
    if (!gameState || gameState.currentPlayerIndex !== HUMAN || gameState.phase !== "playing")
      return;
    // Don't accept input while the completed-trick animation is still playing.
    // If the human taps during this window and clears lastTrick, the AI loop's
    // pending animation-resolver promise would never be fulfilled, leaving
    // loopActiveRef.current === true and freezing all subsequent AI turns.
    if (lastTrick !== null) return;
    ensureSyncStarted(gameState.aiDifficulty);
    if (isQueenOfSpades(card)) {
      humanJustPlayedQSRef.current = true;
      playQueenOfSpades();
    } else {
      playCardPlay();
    }
    const willComplete = gameState.currentTrick.length === 3;
    const completedTrick: readonly TrickCard[] | null = willComplete
      ? [...gameState.currentTrick, { card, playerIndex: HUMAN }]
      : null;

    const newState = playCard(gameState, HUMAN, card);

    if (completedTrick) {
      replay.trick(gameState, completedTrick, newState);
      if (debugEnabled()) {
        trickLogBufferRef.current.push(
          buildDebugTrick(completedTrick, newState.currentLeaderIndex, cpuPlayNotesRef.current)
        );
        cpuPlayNotesRef.current = [];
      }
      void persist(newState);
      // The hand's last trick sweeps too (as when a CPU completes it), so the Q♠'s moment
      // lifts it from the table rather than from an empty slot (#3588).
      setLastTrick({ trick: completedTrick, winnerIndex: newState.currentLeaderIndex });
      setGameState(newState);
      return;
    }
    setLastTrick(null);
    setGameState(newState);
  }

  // Called by TrickArea when the trick-take animation completes. Resolves the
  // AI loop's pending await; for human-led tricks (no pending resolver),
  // clears lastTrick directly.
  function handleTrickAnimationComplete() {
    if (unmountedRef.current) return;
    if (gameState?.phase === "playing") playTrickWon();
    const resolve = trickAnimResolverRef.current;
    if (resolve) {
      trickAnimResolverRef.current = null;
      resolve();
    } else if (lastTrick !== null) {
      setLastTrick(null);
    }
  }

  // ─── Passing ──────────────────────────────────────────────────────────────
  function handlePassCardPress(card: Card) {
    if (!gameState) return;
    setGameState(selectPassCard(gameState, HUMAN, card));
  }

  function handlePassConfirm() {
    if (!gameState) return;
    let s = gameState;
    const passDecisions: DebugPassCard[][] = [[], [], [], []];
    // The principle behind each CPU pass card, from the decision the AI already made (#3283).
    const passPrinciples: (PrincipleId | null)[][] = [[], [], [], []];
    for (let i = 1; i <= 3; i++) {
      const persona = resolvePersona(s.aiDifficulty, i);
      const aiCards = explainCardsToPass(
        [...(s.playerHands[i] ?? [])],
        s.passDirection,
        persona,
        i
      );
      for (const { card, principle, reason } of aiCards) {
        s = selectPassCard(s, i, card);
        passPrinciples[i]!.push(principle);
        if (persona === "conservative") passDecisions[i]!.push({ card, principle, reason });
      }
    }
    replay.passed(s, passPrinciples);
    const committed = commitPass(s);
    if (debugEnabled() && dealSnapshotRef.current) {
      dealSnapshotRef.current = {
        ...dealSnapshotRef.current,
        passDecisions,
        passSelections: s.passSelections,
        finalHands: committed.playerHands,
      };
    }
    setGameState(committed);
  }

  // ─── Hand end / next hand ─────────────────────────────────────────────────
  function handleNextHand() {
    if (!gameState) return;
    setPileSeat(null);
    setLastTrick(null);
    setShowMoonShot(false);
    setQueuedMoonShotSeat(null);
    setShowHeartsBroken(false);
    setShowQueenOfSpades(false);
    momentHold.release();
    const next = dealNextHand(gameState);
    replay.dealt(next);
    if (debugEnabled()) {
      dealSnapshotRef.current = {
        initialHands: next.playerHands,
        passSelections: [[], [], [], []],
        finalHands: next.playerHands,
      };
      trickLogBufferRef.current = [];
      cpuPlayNotesRef.current = [];
    }
    setGameState(next);
    void persist(next);
  }

  // ─── Game over / play again ───────────────────────────────────────────────
  /**
   * Leaves the game in play: abandons it now (the hook's close(), with the
   * progress snapshot), not when the next game's first card opens a session;
   * stops its AI loop and overlays, clears its save, its result and (in dev)
   * its logs, and stops its clock at 0.
   */
  function leaveCurrentGame() {
    // What is still waiting goes to the old game's session before it is closed.
    replay.flush({ force: true });
    replay.reset();
    syncClose();
    gameGenerationRef.current += 1;
    setPileSeat(null);
    setLastTrick(null);
    setShowMoonShot(false);
    setQueuedMoonShotSeat(null);
    setShowHeartsBroken(false);
    setShowQueenOfSpades(false);
    momentHold.release();
    resetSubmission();
    loopActiveRef.current = false;
    gameOverFiredRef.current = false;
    clearGame().catch(() => {});
    if (debugEnabled()) {
      setHandLogs([]);
      trickLogBufferRef.current = [];
      cpuPlayNotesRef.current = [];
      dealSnapshotRef.current = null;
      setHandNotes([]);
    }
    clockRef.current = pausedClock();
  }

  function handleStartGame(requested: AiPreset) {
    // Without the picker every new game is the default CPU; a remembered legacy style is ignored (#3489).
    const wanted = HEARTS_OPPONENT_PICKER_ENABLED ? requested : DEFAULT_AI_PRESET;
    // A premium style starts at the default instead (#1129).
    const difficulty = rememberDifficulty(resolveAvailablePreset(wanted, legacyPersonas));
    leaveCurrentGame();
    const fresh = dealGame(difficulty);
    replay.dealt(fresh);
    if (debugEnabled()) {
      dealSnapshotRef.current = {
        initialHands: fresh.playerHands,
        passSelections: [[], [], [], []],
        finalHands: fresh.playerHands,
      };
    }
    // A new game's clock starts at 0.
    updateClock(fresh);
    setGameState(fresh);
  }

  /** Back to the difficulty picker (the ⋯ New Game item, and Change Difficulty). Without it, a new game. */
  function handleChangeDifficulty() {
    if (!HEARTS_OPPONENT_PICKER_ENABLED) {
      handleStartGame(DEFAULT_AI_PRESET);
      return;
    }
    leaveCurrentGame();
    setGameState(null);
  }

  function handleOpenRename() {
    draftSeedRef.current = {
      wasDefault: playerNames.map((n, i) => n === DEFAULT_NAMES[i]),
      labels: [...playerLabels],
    };
    setDraftNames([...playerLabels]);
    setShowRename(true);
  }

  function handleSaveNames() {
    const seed = draftSeedRef.current;
    const validated = playerNames.map((def, i) => {
      const draft = draftNames[i] ?? "";
      const stored = DEFAULT_NAMES[i] ?? def;
      if (seed.wasDefault[i] && draft.trim() === seed.labels[i]) return stored;
      return validateName(draft, stored);
    });
    setPlayerNames(validated);
    savePlayerNames(validated).catch(() => {});
    setShowRename(false);
  }

  // ─── Derived state ────────────────────────────────────────────────────────
  const humanHand = [...(gameState?.playerHands[HUMAN] ?? [])];
  const isPassing = gameState?.phase === "passing";
  const humanPassSelections = [...(gameState?.passSelections[HUMAN] ?? [])];
  const validCards =
    gameState?.phase === "playing" && gameState.currentPlayerIndex === HUMAN
      ? getValidPlays(gameState, HUMAN)
      : [];
  const displayTrick = lastTrick !== null ? lastTrick.trick : (gameState?.currentTrick ?? []);
  const trickWinnerIndex = lastTrick !== null ? lastTrick.winnerIndex : null;
  const moonShooter = gameState ? detectMoon(gameState.wonCards) : null;
  // The queen's and hearts-broken captions sit just under the trick.
  const momentCaptionTop =
    geometry.trick.area.y + geometry.trick.area.h + 12 * (geometry.trick.cardW / 66);
  const result = heartsResult(gameState?.cumulativeScores ?? [0, 0, 0, 0], HUMAN);

  // ─── Pre-game: show difficulty picker until a game is started ────────────
  if (!gameState && !HEARTS_OPPONENT_PICKER_ENABLED) {
    // Dealt as soon as the saved-game check finishes; an empty shell until then.
    return (
      <GameShell
        gameType="hearts"
        title={t("game.title")}
        onBack={() => navigation.goBack()}
        gutter={null}
        onNewGame={() => handleStartGame(DEFAULT_AI_PRESET)}
        onOpenLeaderboard={openLeaderboard}
        onEditPlayerNames={handleOpenRename}
      >
        <View testID="hearts-loading" />
      </GameShell>
    );
  }
  if (!gameState) {
    return (
      <GameShell
        gameType="hearts"
        title={t("game.title")}
        onBack={() => navigation.goBack()}
        gutter={null}
        onNewGame={() => handleStartGame(selectedDifficulty)}
        onOpenLeaderboard={openLeaderboard}
        onEditPlayerNames={handleOpenRename}
      >
        <ScrollView contentContainerStyle={styles.preGameContainer}>
          {legacyPersonas && (
            <>
              <Text style={[styles.preGameTitle, { color: colors.text }]}>
                {t("difficulty.groupLabel", { defaultValue: "Opponent Style" })}
              </Text>
              <HeartsAiDifficultySelector
                value={selectedDifficulty}
                onChange={setSelectedDifficulty}
              />
            </>
          )}
          <Pressable
            testID="hearts-start-game"
            style={[styles.btn, { backgroundColor: colors.accent }]}
            onPress={() => handleStartGame(selectedDifficulty)}
            accessibilityRole="button"
            accessibilityLabel={t("game.startGame", { defaultValue: "Start Game" })}
          >
            <Text style={[styles.btnText, { color: colors.textOnAccent }]}>
              {t("game.startGame", { defaultValue: "Start Game" })}
            </Text>
          </Pressable>
        </ScrollView>
      </GameShell>
    );
  }

  return (
    <GameShell
      gameType="hearts"
      title={t("game.title")}
      onBack={() => navigation.goBack()}
      gutter={null}
      onNewGame={handleChangeDifficulty}
      onOpenLeaderboard={openLeaderboard}
      onEditPlayerNames={handleOpenRename}
    >
      {/* ── Table: the felt, the four seat plates, the trick and the fanned hand (#3587) ── */}
      <View
        testID="hearts-table"
        style={[styles.table, { backgroundColor: colors.background }]}
        onLayout={handleTableLayout}
      >
        <View
          testID="hearts-felt"
          pointerEvents="none"
          style={[
            styles.felt,
            {
              left: geometry.felt.x,
              top: geometry.felt.y,
              width: geometry.felt.w,
              height: geometry.felt.h,
              borderRadius: geometry.felt.radius,
            },
          ]}
        >
          <LinearGradient
            colors={[HEARTS_FELT_CENTRE, HEARTS_FELT_EDGE]}
            style={StyleSheet.absoluteFill}
          />
        </View>

        {SEAT_POSITIONS.map(({ seat, position }) =>
          position === "self" ? null : (
            <OpponentHand
              key={`fan-${seat}`}
              cardCount={gameState.playerHands[seat]?.length ?? 0}
              label={playerLabels[seat] ?? ""}
              fan={geometry.fans[position]}
              revealCards={__DEV__ && debugMode ? gameState.playerHands[seat] : undefined}
            />
          )
        )}

        <View
          testID="hearts-trick"
          pointerEvents="none"
          style={[
            styles.trickWrapper,
            {
              left: geometry.trick.area.x,
              top: geometry.trick.area.y,
              width: geometry.trick.area.w,
              height: geometry.trick.area.h,
            },
          ]}
        >
          <TrickArea
            trick={[...displayTrick]}
            playerIndex={HUMAN}
            playerLabels={playerLabels}
            winnerIndex={trickWinnerIndex}
            onAnimationComplete={handleTrickAnimationComplete}
            geometry={geometry.trick}
            holdSweep={showQueenOfSpades || showHeartsBroken}
            nudge={showQueenOfSpades}
          />
        </View>

        {SEAT_POSITIONS.map(({ seat, position }) => (
          <SeatPlate
            key={`plate-${seat}`}
            testID={`hearts-plate-${seat}`}
            name={playerLabels[seat] ?? ""}
            score={gameState.cumulativeScores[seat] ?? 0}
            handPoints={penaltyPoints(gameState.wonCards[seat] ?? [])}
            isTurn={gameState.phase === "playing" && gameState.currentPlayerIndex === seat}
            isSelf={position === "self"}
            plate={geometry.plates[position]}
            height={geometry.plateHeight}
            onPress={() => {
              // Not over another dialog (rename) or the hand-end / result cards.
              if (gameState.phase === "playing" && !showRename) setPileSeat(seat);
            }}
          />
        ))}

        {isPassing && (
          <PassBanner
            passDirection={gameState.passDirection}
            selectedCount={humanPassSelections.length}
            onConfirm={handlePassConfirm}
            narrow={geometry.passBanner.w < NARROW_BANNER_WIDTH}
            roomForCounter={geometry.passBanner.h >= COUNTER_MIN_BANNER_H}
            style={{
              position: "absolute",
              left: geometry.passBanner.x,
              top: geometry.passBanner.y,
              width: geometry.passBanner.w,
              maxHeight: geometry.passBanner.h,
              // Edge margins win over `margin`, so each one the banner has is cleared.
              margin: 0,
              marginHorizontal: 0,
              marginBottom: 0,
              zIndex: 4,
              elevation: 4,
            }}
          />
        )}

        {/* Human hand */}
        <View
          testID="hearts-player-hand-area"
          style={[styles.handArea, { left: geometry.hand.rect.x, top: geometry.hand.rect.y }]}
        >
          <PlayerHand
            hand={humanHand}
            selectedCards={isPassing ? humanPassSelections : undefined}
            validCards={isPassing ? undefined : validCards}
            onCardPress={isPassing ? handlePassCardPress : handleCardPress}
            geometry={geometry.hand}
          />
        </View>
        {/* ── The moments (#3588): over the whole table, never taking a touch ── */}
        <View testID="hearts-overlay-broken" style={styles.overlayLayer} pointerEvents="none">
          <HeartsBrokenAnimation
            visible={showHeartsBroken}
            centre={{
              x: geometry.trick.area.x + geometry.trick.area.w / 2,
              y: geometry.trick.area.y + geometry.trick.area.h / 2,
            }}
            cardW={geometry.trick.cardW}
            captionTop={momentCaptionTop}
            width={geometry.width}
            height={geometry.height}
            onAnimationEnd={() => setShowHeartsBroken(false)}
          />
        </View>
        <View testID="hearts-overlay-moon" style={styles.overlayLayer} pointerEvents="none">
          <HeartsMoonShotAnimation
            visible={showMoonShot}
            shooterLabel={playerLabels[moonShotSeat] ?? ""}
            shooterIsHuman={moonShotSeat === HUMAN}
            otherLabels={
              [1, 2, 3].map((d) => playerLabels[(moonShotSeat + d) % 4] ?? "") as [
                string,
                string,
                string,
              ]
            }
            width={geometry.width}
            height={geometry.height}
            onAnimationEnd={handleMoonMomentEnd}
          />
        </View>
        <View testID="hearts-overlay-queen" style={styles.overlayLayer} pointerEvents="none">
          <HeartsQueenOfSpadesAnimation
            visible={showQueenOfSpades}
            card={trickCardRect(geometry, queenSeat)}
            captionTop={momentCaptionTop}
            width={geometry.width}
            height={geometry.height}
            onAnimationEnd={handleQueenMomentEnd}
          />
        </View>
        {showDebugPanel && (
          <Pressable
            style={[styles.devButton, { backgroundColor: colors.accent }]}
            onPress={() => setDebugPanelOpen((prev) => !prev)}
            accessibilityRole="button"
            accessibilityLabel="Toggle Hearts debugger panel"
          >
            <Text style={[styles.devButtonText, { color: colors.textOnAccent }]}>
              {debugPanelOpen ? "DBG ▾" : "DBG ▴"}
            </Text>
          </Pressable>
        )}
      </View>

      {/* ── Cards a seat has taken: opened from its plate (#3587) ──── */}
      <ModalCard
        visible={pileSeat !== null && gameState.phase === "playing"}
        size="sm"
        onRequestClose={() => setPileSeat(null)}
        title={
          pileSeat === null
            ? undefined
            : t("captured.title", { label: playerLabels[pileSeat] ?? "" })
        }
        testID="hearts-captured-modal"
      >
        {pileSeat === HUMAN && <SelfCapturedPile cards={gameState.wonCards[HUMAN] ?? []} />}
        {pileSeat !== null && pileSeat !== HUMAN && (
          <OpponentCapturedPile
            cards={gameState.wonCards[pileSeat] ?? []}
            seatLabel={playerLabels[pileSeat] ?? ""}
          />
        )}
        <Pressable
          style={[styles.btn, { backgroundColor: colors.surfaceAlt }]}
          onPress={() => setPileSeat(null)}
          accessibilityRole="button"
          accessibilityLabel={t("captured.close")}
          testID="hearts-captured-close"
        >
          <Text style={[styles.btnText, { color: colors.text }]}>{t("captured.close")}</Text>
        </Pressable>
      </ModalCard>

      {/* ── Hand-end overlay (dealing phase = hand just finished) ──── */}
      {gameState.phase === "dealing" && !momentPending && (
        <ModalCard visible size="md">
          <ScrollView
            style={styles.panelScroll}
            contentContainerStyle={styles.panelScrollContent}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            bounces={false}
          >
            <Text style={[styles.panelTitle, { color: colors.text }]}>{t("hand_end.title")}</Text>
            {moonShooter !== null && (
              <Text style={[styles.moonText, { color: colors.accent }]}>
                {t("hand_end.moon", { label: playerLabels[moonShooter] ?? "" })}
              </Text>
            )}
            <HeartsScorecard
              playerLabels={playerLabels}
              cumulativeScores={[...gameState.cumulativeScores]}
              scoreHistory={scoreHistory}
              compact
            />
            <Pressable
              style={[styles.btn, { backgroundColor: colors.accent }]}
              onPress={handleNextHand}
              accessibilityRole="button"
              accessibilityLabel={t("hand_end.next")}
            >
              <Text style={[styles.btnText, { color: colors.textOnAccent }]}>
                {t("hand_end.next")}
              </Text>
            </Pressable>
          </ScrollView>
        </ModalCard>
      )}

      {/* ── Game over: the shared result card (#2506) ─────────────── */}
      <GameResultModal
        visible={gameState.phase === "game_over" && !momentPending}
        outcome={result.outcome}
        winnerName={playerLabels[result.winnerIndex] ?? ""}
        eyebrow={t("game.title")}
        subtitle={tResult("subtitle.reachedLimit", {
          name: playerLabels[result.limitIndex] ?? "",
          score: gameState.cumulativeScores[result.limitIndex] ?? 0,
        })}
        detail={
          <HeartsFinalStandings
            playerLabels={playerLabels}
            cumulativeScores={gameState.cumulativeScores}
            humanIndex={HUMAN}
          />
        }
        submission={toSubmission(leaderboard)}
        onViewLeaderboard={openLeaderboard}
        onPlayAgain={() => handleStartGame(gameState.aiDifficulty)}
        secondaryAction={
          HEARTS_OPPONENT_PICKER_ENABLED
            ? { label: tResult("action.changeDifficulty"), onPress: handleChangeDifficulty }
            : undefined
        }
        onHome={() => navigation.popToTop()}
        testID="hearts-result"
      />

      {/* ── Hearts debug panel (dev + internal test builds) ──────── */}
      {DebugPanel && (
        <DebugPanel
          visible={debugPanelOpen}
          onClose={() => setDebugPanelOpen(false)}
          logs={handLogs}
          notes={handNotes}
          playerLabels={playerLabels}
          aiDifficulty={gameState.aiDifficulty}
          // Reads the log refs during render, which is only safe because the panel calls
          // this while visible and HeartsScreen re-renders on every setGameState (each
          // CPU play), so the refs are never stale for long.
          getLive={() =>
            ({
              handNumber: gameState.handNumber,
              tricks: trickLogBufferRef.current,
              pending: cpuPlayNotesRef.current,
              ...(dealSnapshotRef.current
                ? {
                    pass: {
                      passDirection: gameState.passDirection,
                      initialHands: dealSnapshotRef.current.initialHands,
                      passSelections: dealSnapshotRef.current.passSelections,
                      passDecisions: dealSnapshotRef.current.passDecisions,
                    },
                  }
                : {}),
            }) satisfies LiveDecisions
          }
          onNotesChange={(idx, text) =>
            setHandNotes((prev) => {
              const next = [...prev];
              next[idx] = text;
              return next;
            })
          }
        />
      )}

      {/* ── Rename players modal ───────────────────────────────────── */}
      <ModalCard
        visible={showRename}
        size="md"
        animationType="slide"
        onRequestClose={() => setShowRename(false)}
        title={t("settings.rename_title")}
      >
        <ScrollView style={styles.renameScroll} contentContainerStyle={styles.renameContent}>
          {seatDefaults.map((def, i) => (
            <View key={i} style={styles.renameRow}>
              <Text style={[styles.renameLabel, { color: colors.textMuted }]}>
                {t("settings.player_label", { n: i + 1, default: def })}
              </Text>
              <TextInput
                style={[
                  styles.renameInput,
                  {
                    color: colors.text,
                    borderColor: colors.border,
                    backgroundColor: colors.surfaceAlt,
                  },
                ]}
                value={draftNames[i] ?? ""}
                onChangeText={(v) =>
                  setDraftNames((prev) => {
                    const next = [...prev];
                    next[i] = v;
                    return next;
                  })
                }
                placeholder={def}
                placeholderTextColor={colors.textMuted}
                maxLength={32}
                accessibilityLabel={t("settings.player_label", { n: i + 1, default: def })}
              />
            </View>
          ))}
        </ScrollView>
        <Pressable
          style={[styles.btn, { backgroundColor: colors.accent }]}
          onPress={handleSaveNames}
          accessibilityRole="button"
          accessibilityLabel={t("settings.save")}
        >
          <Text style={[styles.btnText, { color: colors.textOnAccent }]}>{t("settings.save")}</Text>
        </Pressable>
        <Pressable
          style={[styles.btn, { backgroundColor: colors.surfaceAlt }]}
          onPress={() => setShowRename(false)}
          accessibilityRole="button"
          accessibilityLabel={t("settings.cancel")}
        >
          <Text style={[styles.btnText, { color: colors.text }]}>{t("settings.cancel")}</Text>
        </Pressable>
      </ModalCard>
    </GameShell>
  );
}

const styles = StyleSheet.create({
  table: {
    flex: 1,
    position: "relative",
  },
  felt: {
    position: "absolute",
    overflow: "hidden",
    borderWidth: 1,
    borderColor: HEARTS_FELT_BORDER,
  },
  trickWrapper: {
    position: "absolute",
    // Above the plates on both platforms, so a won trick sweeps over the winner's plate
    // (Android orders siblings by elevation, iOS by zIndex).
    zIndex: 3,
    elevation: 3,
  },
  handArea: {
    position: "absolute",
  },
  panelScroll: {
    width: "100%",
  },
  panelScrollContent: {
    gap: 16,
    alignItems: "center",
  },
  panelTitle: {
    fontSize: 20,
    fontWeight: "700",
  },
  moonText: {
    fontSize: 14,
    fontWeight: "600",
    textAlign: "center",
  },
  btn: {
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 8,
    alignItems: "center",
    width: "100%",
  },
  btnText: {
    fontSize: 16,
    fontWeight: "700",
  },
  renameScroll: {
    width: "100%",
    maxHeight: 260,
  },
  renameContent: {
    gap: 12,
  },
  renameRow: {
    gap: 4,
  },
  renameLabel: {
    fontSize: 12,
    fontWeight: "600",
  },
  renameInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 15,
  },
  preGameContainer: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
    gap: 20,
  },
  preGameTitle: {
    fontSize: 18,
    fontWeight: "700",
  },
  // Above the trick layer (3) and the pass banner (4).
  overlayLayer: {
    ...StyleSheet.absoluteFill,
    zIndex: 5,
    elevation: 5,
  },
  devButton: {
    position: "absolute",
    zIndex: 5,
    elevation: 5,
    bottom: 8,
    right: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
    opacity: 0.8,
  },
  devButtonText: {
    fontSize: 10,
    fontWeight: "700",
  },
});
