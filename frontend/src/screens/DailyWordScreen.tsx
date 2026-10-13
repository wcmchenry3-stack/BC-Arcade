/**
 * DailyWordScreen — Wordle-style daily word game (#1193).
 *
 * Layers:
 *   1. Engine: pure functions from game/daily_word/engine.ts
 *   2. Persistence: `usePersistedGameState` (#3109) over
 *      game/daily_word/storage.ts, one board per puzzle (#3230). The load
 *      fetches today's puzzle, then its saved board (Retry runs it again);
 *      without one, today's board is dealt. The load only reads: the restore
 *      handler prunes other puzzles' boards (#3127). Every change is saved
 *      after that, except a finished board just restored, which is already
 *      stored.
 *   3. API: GET /daily-word/today and GET /daily-word/answer here;
 *      POST /daily-word/guess and its 403/422/429 recovery live in
 *      useDailyWordSubmit (components/daily_word, #2981).
 *   4. Animation: Reanimated scaleX tile flip on each guess submission.
 *   5. Offline (#3230): on a network failure, today's puzzle comes from the
 *      ones fetched ahead (game/daily_word/offlinePuzzles.ts) and its guesses
 *      are scored on the device; past the 3-day window, the shared reconnect
 *      message shows instead.
 *
 * State (#2981): the result card's visibility is derived — shown when
 * `state.is_complete`, unless `revealPending` holds it back while the last
 * row flips or the answer loads (`state.won` picks the win or loss card).
 * The card has no dismiss: closing it goes Home. The error toast and the
 * "Copied!" label both run on the shared useTransientToast.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
  Share,
} from "react-native";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import GameResultModal from "../components/shared/GameResultModal";
import { CountdownButtonLabel } from "../components/shared/CountdownButtonLabel";
import {
  initialState,
  setCurrentRowLetter,
  deleteLastLetter,
  buildShareText,
  guessCount as countGuesses,
  sessionResult,
} from "../game/daily_word/engine";
import type { DailyWordState } from "../game/daily_word/types";
import { dailyWordApi } from "../game/daily_word/api";
import type { TodayResponse } from "../game/daily_word/api";
import { withRetry } from "../game/_shared/withRetry";
import { useGameSync } from "../game/_shared/useGameSync";
import {
  LoadResult,
  useGameRestored,
  usePersistedGameState,
} from "../game/_shared/usePersistedGameState";
import {
  loadState,
  saveState,
  clearState,
  pruneStates,
  saveTodayMeta,
  loadTodayMeta,
} from "../game/daily_word/storage";
import {
  offlineAnswerFor,
  resolveOfflinePuzzle,
  type OfflinePuzzle,
} from "../game/daily_word/offlinePuzzles";
import { getLastKnownStreak } from "../game/_shared/lastKnownStreak";
import { isNetworkError } from "../game/_shared/httpClient";
import DailyWordDevPanel from "../components/daily_word/DailyWordDevPanel";
import { TileRow } from "../components/daily_word/WordTile";
import { WordKeyboard } from "../components/daily_word/WordKeyboard";
import { Toast } from "../components/daily_word/Toast";
import { useDailyWordSubmit } from "../components/daily_word/useDailyWordSubmit";
import { useTransientToast } from "../components/shared/useTransientToast";
import { DAILY_WORD_SOUNDS } from "../game/daily_word/sounds";
import { useSound } from "../game/_shared/useSound";
import { getLanguage, getTimezoneOffset, localDateKey } from "../game/daily_word/todayMeta";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOAST_DURATION_MS = 2000;
/** How long to wait before retrying when the server hasn't rolled over yet. */
const NEXT_WORD_RETRY_MS = 60_000;
const DEEP_LINK = "https://bcarcade.app/daily-word";
/** The GameShell error for each load failure (#2925); "exhausted" uses the shared message. */
const LOAD_ERROR_KEY = {
  offline: "error.needsConnection",
  failed: "error.couldNotLoad",
} as const;

/**
 * Why no puzzle loaded: offline with nothing cached, offline past the 3-day
 * window (#3230), or anything else.
 */
type LoadFailure = "offline" | "exhausted" | "failed";

/** What loading today's puzzle in place of the current one did. */
type ResetResult = "ok" | "same" | "failed" | "exhausted";

/**
 * What a load found besides the board, for the restore handler to act on
 * (#3127): the load itself writes nothing.
 */
interface LoadInfo {
  /** Why no puzzle loaded (the board is null). */
  failure: LoadFailure | null;
  /** The board is today's save, resumed. */
  resumed: boolean;
  /** Today's puzzle as fetched from the server, for the offline cache (#1886). */
  cache: { dateKey: string; meta: TodayResponse } | null;
  /** Today's puzzle came from the ones fetched ahead: score it on the device (#3230). */
  offline: OfflinePuzzle | null;
  /** The last known streak, for the "exhausted" message's streak line (#3230). */
  streak: number | null;
}

/**
 * The shared "3 days since you connected" message (#3043), with the streak
 * line when the player has a streak.
 */
function exhaustedMessage(tCommon: TFunction<"common">, streak: number | null): string {
  const message = tCommon("offline.windowExhausted");
  return streak !== null && streak > 0
    ? `${message} ${tCommon("offline.windowExhaustedStreak")}`
    : message;
}

/** A load failure a reconnect can fix gets a Retry button (#2925, #3230). */
function offersRetry(failure: LoadFailure | null): boolean {
  return failure === "offline" || failure === "exhausted";
}

/** The text for a failure to load a puzzle (on mount, Retry or Play Again). */
function failureMessage(
  failure: LoadFailure,
  t: TFunction<"daily_word">,
  tCommon: TFunction<"common">,
  streak: number | null
): string {
  return failure === "exhausted" ? exhaustedMessage(tCommon, streak) : t(LOAD_ERROR_KEY[failure]);
}

/** A load's result: the board (null when none loaded) and what else it found. */
function loadResult(
  board: DailyWordState | null,
  info: Partial<LoadInfo>
): LoadResult<DailyWordState, LoadInfo> {
  return new LoadResult(board, {
    failure: null,
    resumed: false,
    cache: null,
    offline: null,
    streak: null,
    ...info,
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function msUntilMidnight(tzOffsetMinutes: number): number {
  const nowMs = Date.now();
  const tzOffsetMs = tzOffsetMinutes * 60 * 1000;
  const localMs = nowMs + tzOffsetMs;
  const startOfLocalDayMs = Math.floor(localMs / 86400000) * 86400000;
  return startOfLocalDayMs + 86400000 - localMs;
}

/**
 * Shares the result: the clipboard on web, the system share sheet on iOS and
 * Android (#2514 — previously a silent no-op on native that still said
 * "Copied!"). Resolves to "copied" only when text was actually copied.
 */
async function shareResult(text: string): Promise<"copied" | "shared" | "none"> {
  if (Platform.OS === "web") {
    if (typeof navigator !== "undefined" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return "copied";
    }
    return "none";
  }
  await Share.share({ message: text });
  return "shared";
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function DailyWordScreen() {
  const { t } = useTranslation("daily_word");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  // A finished board the load restored: it is already stored as it is, so the
  // save below skips it (a finished puzzle is never re-saved, #3109).
  const restoredFinishedRef = useRef<DailyWordState | null>(null);
  // The puzzle being played offline, with its answer (#3230): its guesses are
  // scored on the device. Null when the board came from the server.
  const offlinePuzzleRef = useRef<OfflinePuzzle | null>(null);

  // The saved game (usePersistedGameState, #3109), one board per puzzle
  // (`daily_word_board_<puzzle_id>`, #3230). The load fetches today's puzzle,
  // then its saved board, both recomputed per call: Retry (`reload`) can run
  // hours after mount (new day, new language). A saved board for today
  // resumes; otherwise today's fresh board is returned. Offline (a network
  // failure), today's puzzle comes from the ones fetched ahead (#3230), then
  // the cached today metadata (#2925). A failed load resolves null with its
  // reason. The load only reads (#3127): what it found goes to the restore
  // handler as `LoadInfo`, and the handler acts on it (the error, the resume,
  // pruning other days' boards, the today-meta cache), since only the load
  // that lands reaches the handler. `stateRef` is the latest state, read by
  // the async submit, the session abandon paths and the unmount snapshot,
  // none of which can close over `state`.
  const game = usePersistedGameState<DailyWordState, LoadInfo>({
    load: async (): Promise<LoadResult<DailyWordState, LoadInfo>> => {
      const tzOffset = getTimezoneOffset();
      const language = getLanguage();
      const dateKey = localDateKey(tzOffset, language);
      let failure = "failed" as LoadFailure;
      // Set in callbacks, so typed by assertion to keep them from narrowing to null.
      let cache = null as LoadInfo["cache"];
      let offline = null as OfflinePuzzle | null;
      try {
        const todayMeta = await withRetry(() => dailyWordApi.getToday(tzOffset, language))
          .then((meta) => {
            cache = { dateKey, meta };
            return meta;
          })
          // Only serve cached puzzles on network failures (isNetworkError). HTTP
          // errors such as 401 mean the server is actively denying access —
          // falling back to cache would bypass that.
          .catch(async (e): Promise<TodayResponse | null> => {
            if (!isNetworkError(e)) return null;
            // Offline play (#3230): the puzzle fetched ahead for today, if this
            // language plays offline; "exhausted" once the window is used up.
            const ahead = await resolveOfflinePuzzle(tzOffset, language);
            if (ahead === "exhausted") {
              failure = "exhausted";
              return null;
            }
            if (ahead) {
              offline = ahead;
              return { puzzle_id: ahead.puzzle_id, word_length: ahead.word_length };
            }
            const cached = await loadTodayMeta(dateKey);
            if (!cached) failure = "offline";
            return cached;
          });

        if (!todayMeta) {
          const streak = failure === "exhausted" ? await getLastKnownStreak() : null;
          return loadResult(null, { failure, cache, streak });
        }
        const saved = await loadState(todayMeta.puzzle_id);
        if (saved && saved.puzzle_id === todayMeta.puzzle_id) {
          return loadResult(saved, { resumed: true, cache, offline });
        }
        const fresh = initialState(todayMeta.puzzle_id, todayMeta.word_length, language);
        return loadResult(fresh, { cache, offline });
      } catch {
        return loadResult(null, { failure: "failed" });
      }
    },
    save: (s) => {
      if (s === restoredFinishedRef.current) return Promise.resolve();
      return saveState(s);
    },
  });
  const { state, setState, stateRef, loading, reload } = game;
  // "offline" = network failure with no cached metadata (#2925); "exhausted" =
  // offline past the puzzles fetched ahead (#3230); "failed" = anything else.
  const [loadError, setLoadError] = useState<LoadFailure | null>(null);
  // The last known streak shown with the "exhausted" message (#3230).
  const [exhaustedStreak, setExhaustedStreak] = useState<number | null>(null);
  const { t: tCommon } = useTranslation("common");
  // The latest toast text; `errorToast` decides whether it is showing.
  const [toastMessage, setToastMessage] = useState("");
  const errorToast = useTransientToast(TOAST_DURATION_MS);
  const copiedToast = useTransientToast(TOAST_DURATION_MS);
  // Holds a finished board's result card back while its last row flips or
  // its answer loads; otherwise the card shows whenever the puzzle is done.
  const [revealPending, setRevealPending] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  // The next puzzle's release time, fixed when the result appears (#2514).
  // msUntilMidnight() jumps to the following midnight once one passes, so a
  // countdown recomputed from it would never reach zero. The card's
  // CountdownButtonLabel ticks toward it on its own (#2964).
  const [nextWordAt, setNextWordAt] = useState<number | null>(null);
  const [nextWordReady, setNextWordReady] = useState(false);
  // Play Again couldn't load the next puzzle (offline, server error), or the
  // puzzles fetched ahead have run out (#3230).
  const [playAgainFailed, setPlayAgainFailed] = useState<false | "failed" | "exhausted">(false);
  const [flippingRowIndex, setFlippingRowIndex] = useState<number | null>(null);

  // Dev panel (#1293) — gated by __DEV__
  const [devOpen, setDevOpen] = useState(false);

  const mountedRef = useRef(true);
  const language = getLanguage();
  const tzOffset = getTimezoneOffset();

  // #2451 — report each puzzle attempt as a per-session game so it earns Arcade
  // XP, shows in Profile history and can be measured by the daily challenge.
  // The session opens on the first accepted guess (not on load), so opening a
  // finished or untouched puzzle creates no row. Abandons on unmount are handled
  // by the hook; the snapshot below gives them the result block.
  const {
    start: syncStart,
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("daily_word");

  // #2926 — the shared win fanfare, played when a solve is revealed (a guess
  // or a recovered `already_solved`), never when a finished board is restored.
  const { play: playWin } = useSound("dailyWord.win", DAILY_WORD_SOUNDS);

  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: sessionResult(stateRef.current) }));
  }, [syncSetProgressSnapshot, stateRef]);

  // ---------------------------------------------------------------------------
  // Countdown timer
  // ---------------------------------------------------------------------------

  const startCountdown = useCallback(
    (untilMs?: number) => {
      setNextWordAt(untilMs ?? Date.now() + msUntilMidnight(tzOffset));
      setNextWordReady(false);
    },
    [tzOffset]
  );
  const handleNextWordReady = useCallback(() => setNextWordReady(true), []);
  const countdownLabel = useCallback((time: string) => t("result.countdown", { time }), [t]);

  /**
   * Loads today's puzzle in place of the current one. Fetches before clearing
   * the saved game, so a failure leaves the finished result intact (#2553
   * review). With `requireNewPuzzle`, a server still serving the current
   * puzzle (device clock ahead of the server's) changes nothing: "same".
   * Offline (a network failure), the next puzzle comes from the ones fetched
   * ahead (#3230), or "exhausted" once they have run out.
   */
  const hideCopied = copiedToast.hide;
  const resetToToday = useCallback(
    async ({ requireNewPuzzle = false } = {}): Promise<ResetResult> => {
      try {
        let todayMeta: TodayResponse;
        let offline: OfflinePuzzle | null = null;
        try {
          todayMeta = await dailyWordApi.getToday(tzOffset, language);
        } catch (e) {
          if (!isNetworkError(e)) return "failed";
          const ahead = await resolveOfflinePuzzle(tzOffset, language);
          if (ahead === "exhausted") {
            const streak = await getLastKnownStreak();
            if (mountedRef.current) setExhaustedStreak(streak);
            return "exhausted";
          }
          if (!ahead) return "failed";
          todayMeta = ahead;
          offline = ahead;
        }
        if (requireNewPuzzle && todayMeta.puzzle_id === stateRef.current?.puzzle_id) {
          return "same";
        }
        const previous = stateRef.current;
        if (previous) await clearState(previous.puzzle_id);
        offlinePuzzleRef.current = offline;
        // The old puzzle's session must close now: left open, the next guess would
        // skip start() and be reported against the old puzzle_id.
        if (syncGetGameId()) {
          const result = sessionResult(stateRef.current);
          syncComplete({ outcome: "abandoned", result }, result);
        }
        const fresh = initialState(todayMeta.puzzle_id, todayMeta.word_length, language);
        setState(fresh);
        setAnswer(null);
        setRevealPending(false);
        setFlippingRowIndex(null);
        setNextWordReady(false);
        setNextWordAt(null);
        hideCopied();
        setPlayAgainFailed(false);
        return "ok";
      } catch {
        return "failed";
      }
    },
    [tzOffset, language, syncGetGameId, syncComplete, hideCopied, stateRef, setState]
  );

  const handlePlayAgain = useCallback(async () => {
    setPlayAgainFailed(false);
    const result = await resetToToday({ requireNewPuzzle: true });
    if (!mountedRef.current) return;
    if (result === "same") {
      // The server hasn't moved on yet: count down briefly and try again.
      startCountdown(Date.now() + NEXT_WORD_RETRY_MS);
    } else if (result === "failed" || result === "exhausted") {
      setPlayAgainFailed(result);
    }
  }, [resetToToday, startCountdown]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  const showErrorToast = errorToast.show;
  const showToast = useCallback(
    (message: string) => {
      setToastMessage(message);
      showErrorToast();
    },
    [showErrorToast]
  );

  // ---------------------------------------------------------------------------
  // Mount (and Retry): today's puzzle and any saved state
  // ---------------------------------------------------------------------------

  useGameRestored(game, (gameState, info) => {
    if (info.cache) saveTodayMeta(info.cache.dateKey, info.cache.meta).catch(() => {});
    if (gameState === null) {
      setExhaustedStreak(info.streak);
      setLoadError(info.failure ?? "failed");
      return;
    }
    setLoadError(null);
    offlinePuzzleRef.current = info.offline;
    // Every other puzzle's board (another day's or language's) is pruned here,
    // not in the load, so a dropped load can never remove a board a newer one
    // has written (#3127). Boards are per puzzle (#3230), so this never
    // touches the board being played.
    pruneStates(gameState.puzzle_id).catch(() => {});
    // A restored board continues the session a killed app left open for this
    // puzzle (#2654).
    if (info.resumed && !gameState.is_complete) {
      syncResume({ puzzle_id: gameState.puzzle_id });
    }
    // A restored finished board shows its card at once (derived from
    // is_complete); a loss fills in the answer when it arrives.
    if (gameState.is_complete) {
      restoredFinishedRef.current = gameState;
      if (!gameState.won && info.offline) {
        // Offline (#3230): the answer fetched ahead.
        setAnswer(info.offline.answer.toUpperCase());
      } else if (!gameState.won) {
        dailyWordApi
          .getAnswer(gameState.puzzle_id)
          .then((r) => {
            if (mountedRef.current) setAnswer(r.answer.toUpperCase());
          })
          .catch(() => {});
      }
      startCountdown();
    }
  });

  // ---------------------------------------------------------------------------
  // Input handlers
  // ---------------------------------------------------------------------------

  const handleLetter = useCallback(
    async (letter: string) => {
      setState((s) => {
        if (!s || s.is_complete) return s;
        return setCurrentRowLetter(s, letter.toLowerCase());
      });
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
    },
    [setState]
  );

  const handleDelete = useCallback(async () => {
    setState((s) => {
      if (!s || s.is_complete) return s;
      return deleteLastLetter(s);
    });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, [setState]);

  // Scoring on the device (#3230): every guess on a puzzle loaded offline,
  // and a guess whose request fails for want of a connection when its
  // puzzle was fetched ahead.
  const scoresOnDevice = useCallback(
    (puzzleId: string) => offlinePuzzleRef.current?.puzzle_id === puzzleId,
    []
  );
  const deviceAnswer = useCallback(async (puzzleId: string): Promise<string | null> => {
    const offline = offlinePuzzleRef.current;
    if (offline?.puzzle_id === puzzleId) return offline.answer;
    return offlineAnswerFor(puzzleId);
  }, []);

  const { submit: onSubmit, submitting } = useDailyWordSubmit(
    stateRef,
    {
      start: syncStart,
      markStarted: syncMarkStarted,
      complete: syncComplete,
      getGameId: syncGetGameId,
    },
    {
      tzOffset,
      setState,
      showToast,
      setFlippingRowIndex,
      setRevealPending,
      setAnswer,
      startCountdown,
      playWin,
      resetToToday,
      scoresOnDevice,
      deviceAnswer,
    }
  );

  const handleKey = useCallback(
    (key: string) => {
      if (key === "Enter") {
        void onSubmit();
      } else if (key === "Delete") {
        void handleDelete();
      } else {
        void handleLetter(key);
      }
    },
    [onSubmit, handleDelete, handleLetter]
  );

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const guessCount = state ? countGuesses(state) : 0;

  async function handleShare() {
    if (!state) return;
    try {
      const outcome = await shareResult(buildShareText(state, DEEP_LINK));
      if (outcome !== "copied" || !mountedRef.current) return;
      copiedToast.show();
    } catch {
      // Share dismissed or clipboard unavailable — nothing to report.
    }
  }

  if (loading) {
    return (
      <GameShell gameType="daily_word" title={t("game.title")} requireBack gutter={null} loading>
        {null}
      </GameShell>
    );
  }

  return (
    <GameShell
      gameType="daily_word"
      title={t("game.title")}
      requireBack
      gutter={null}
      error={loadError ? failureMessage(loadError, t, tCommon, exhaustedStreak) : null}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <View style={styles.body}>
        {/* Toast */}
        <Toast message={errorToast.visible ? toastMessage : null} />

        {offersRetry(loadError) && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={t("error.retry")}
            style={[styles.retryButton, { backgroundColor: colors.accent }]}
            onPress={() => {
              setLoadError(null);
              reload();
            }}
          >
            <Text style={[styles.retryText, { color: colors.textOnAccent }]}>
              {t("error.retry")}
            </Text>
          </Pressable>
        )}

        {/* Tile grid */}
        {state !== null && (
          <View style={styles.grid} accessibilityLabel={t("a11y.board")}>
            {state.rows.map((_, rowIndex) => (
              <TileRow
                key={rowIndex}
                state={state}
                rowIndex={rowIndex}
                wordLength={state.word_length}
                isFlipping={flippingRowIndex === rowIndex}
              />
            ))}
          </View>
        )}

        {/* Keyboard — always rendered to prevent layout jump during flip animation;
            hidden via opacity + pointerEvents once game is complete */}
        {state !== null && (
          <View
            style={{ opacity: state.is_complete ? 0 : 1 }}
            pointerEvents={state.is_complete ? "none" : "auto"}
          >
            <WordKeyboard
              keyboardState={state.keyboard_state}
              language={language}
              onKey={handleKey}
            />
          </View>
        )}

        {/* Loading indicator during submit */}
        {submitting && <ActivityIndicator style={styles.submitIndicator} color={colors.accent} />}

        {/* Dev panel (#1293): its DEV button sits in the board's top-left corner */}
        <DailyWordDevPanel
          enabled={__DEV__}
          open={devOpen}
          onOpen={() => setDevOpen(true)}
          onClose={() => setDevOpen(false)}
          state={state}
          onReset={resetToToday}
        />
      </View>

      {/* End-of-game result card (#2514) */}
      {state !== null && (
        <GameResultModal
          visible={state.is_complete && !revealPending}
          outcome={state.won ? "win" : "loss"}
          eyebrow={t("game.title")}
          subtitle={
            playAgainFailed
              ? failureMessage(playAgainFailed, t, tCommon, exhaustedStreak)
              : state.won
                ? tResult("subtitle.solvedIn", { count: guessCount })
                : answer !== null
                  ? t("result.loss.answer", { answer })
                  : undefined
          }
          hero={{
            kind: "score",
            label: tResult("stat.guesses"),
            value: state.won ? `${guessCount}/6` : "X/6",
          }}
          primaryAction={
            nextWordReady
              ? { label: tResult("action.playAgain"), onPress: () => void handlePlayAgain() }
              : {
                  label: countdownLabel(""),
                  labelNode: (textStyle) =>
                    nextWordAt !== null ? (
                      <CountdownButtonLabel
                        untilMs={nextWordAt}
                        renderLabel={countdownLabel}
                        onReady={handleNextWordReady}
                        style={textStyle}
                      />
                    ) : null,
                  onPress: () => {},
                  disabled: true,
                }
          }
          secondaryAction={{
            label: copiedToast.visible ? t("result.copied") : t("result.share"),
            accessibilityLabel: t("result.share"),
            onPress: () => void handleShare(),
          }}
          onHome={() => navigation.popToTop()}
          testID="daily-word-result"
        />
      )}
    </GameShell>
  );
}

const styles = StyleSheet.create({
  retryButton: {
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  retryText: {
    fontFamily: typography.heading,
    fontSize: 16,
    fontWeight: "700",
  },
  body: {
    flex: 1,
    alignItems: "center",
    justifyContent: "space-between",
    paddingTop: 16,
    paddingBottom: 8,
    position: "relative",
  },
  grid: {
    gap: 6,
    alignItems: "center",
  },
  submitIndicator: {
    position: "absolute",
    bottom: 16,
    width: 40,
    height: 40,
    alignSelf: "center",
  },
});
