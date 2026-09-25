/**
 * DailyWordScreen — Wordle-style daily word game (#1193).
 *
 * Layers:
 *   1. Engine: pure functions from game/daily_word/engine.ts
 *   2. Persistence: AsyncStorage via game/daily_word/storage.ts; state loaded
 *      on mount and saved after every mutation.
 *   3. API: GET /daily-word/today, POST /daily-word/guess, GET /daily-word/answer
 *   4. Animation: Reanimated scaleX tile flip on each guess submission.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  Share,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withSequence,
  withTiming,
  withDelay,
} from "react-native-reanimated";
import * as Haptics from "expo-haptics";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import i18n from "i18next";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import GameResultModal from "../components/shared/GameResultModal";
import {
  initialState,
  setCurrentRowLetter,
  deleteLastLetter,
  applyServerResult,
  markComplete,
  buildShareText,
  guessCount as countGuesses,
  withServerGuessCount,
  sessionResult,
} from "../game/daily_word/engine";
import type { DailyWordState, TileStatus } from "../game/daily_word/types";
import { dailyWordApi } from "../game/daily_word/api";
import { withRetry } from "../game/_shared/withRetry";
import { recordedOutcome } from "../game/_shared/recordedOutcome";
import { useGameSync } from "../game/_shared/useGameSync";
import {
  loadState,
  saveState,
  clearState,
  saveTodayMeta,
  loadTodayMeta,
} from "../game/daily_word/storage";
import { ApiError, isNetworkError } from "../game/_shared/httpClient";
import { devLog } from "../game/daily_word/devLog";
import type { DevLogEntry } from "../game/daily_word/devLog";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const FLIP_HALF_MS = 150;
const TILE_STAGGER_MS = 100;
const TOAST_DURATION_MS = 2000;
const DEEP_LINK = "https://bcarcade.app/daily-word";

const QWERTY_ROWS = [
  ["Q", "W", "E", "R", "T", "Y", "U", "I", "O", "P"],
  ["A", "S", "D", "F", "G", "H", "J", "K", "L"],
  ["Enter", "Z", "X", "C", "V", "B", "N", "M", "Delete"],
] as const;

// Devanagari consonants + matras in Varnamala order
const DEVANAGARI_ROWS = [
  ["क", "ख", "ग", "घ", "च", "छ", "ज", "झ", "ट", "ठ"],
  ["ड", "ढ", "त", "थ", "द", "ध", "न", "प", "फ", "ब"],
  ["Enter", "भ", "म", "य", "र", "ल", "व", "श", "स", "Delete"],
  ["ह", "ा", "ि", "ी", "ु", "ू", "े", "ै", "ो", "ौ"],
] as const;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTimezoneOffset(): number {
  return -new Date().getTimezoneOffset();
}

function getLanguage(): string {
  return i18n.language?.startsWith("hi") ? "hi" : "en";
}

function msUntilMidnight(tzOffsetMinutes: number): number {
  const nowMs = Date.now();
  const tzOffsetMs = tzOffsetMinutes * 60 * 1000;
  const localMs = nowMs + tzOffsetMs;
  const startOfLocalDayMs = Math.floor(localMs / 86400000) * 86400000;
  return startOfLocalDayMs + 86400000 - localMs;
}

function localDateKey(tzOffsetMinutes: number, lang: string): string {
  const localMs = Date.now() + tzOffsetMinutes * 60_000;
  const dayMs = Math.floor(localMs / 86_400_000) * 86_400_000;
  const d = new Date(dayMs);
  const y = d.getUTCFullYear();
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dy = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${dy}_${lang}`;
}

function formatCountdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, "0");
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
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
// Tile component
// ---------------------------------------------------------------------------

const TILE_STATUS_COLORS: Record<TileStatus, string> = {
  correct: "#538d4e",
  present: "#b59f3b",
  absent: "#3a3a3c",
  tbd: "transparent",
  empty: "transparent",
};

function WordTile({
  letter,
  status,
  isFlipping,
  flipDelay,
  testID,
}: {
  readonly letter: string;
  readonly status: TileStatus;
  readonly isFlipping: boolean;
  readonly flipDelay: number;
  readonly testID?: string;
}) {
  const { colors } = useTheme();
  // scaleX 1→0→1 gives the same visual flip as rotateY without 3D compositing
  // artifacts that cause black-screen flicker on web and some iOS renderers.
  const scale = useSharedValue(1);
  const [visibleStatus, setVisibleStatus] = useState<TileStatus>(isFlipping ? "tbd" : status);

  useEffect(() => {
    if (!isFlipping) {
      setVisibleStatus(status);
      return;
    }
    scale.value = 1;
    scale.value = withDelay(
      flipDelay,
      withSequence(
        withTiming(0, { duration: FLIP_HALF_MS }),
        withTiming(1, { duration: FLIP_HALF_MS })
      )
    );
    const timer = setTimeout(() => setVisibleStatus(status), flipDelay + FLIP_HALF_MS);
    return () => clearTimeout(timer);
    // isFlipping and status are the only meaningful triggers
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFlipping, status]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ scaleX: scale.value }],
  }));

  const bg =
    visibleStatus === "tbd" || visibleStatus === "empty"
      ? (colors.surface ?? "#1a1a1b")
      : TILE_STATUS_COLORS[visibleStatus];
  const hasBorder = visibleStatus === "empty" || visibleStatus === "tbd";
  const borderColor = letter ? colors.textMuted : colors.border;

  return (
    <Animated.View
      testID={testID}
      style={[
        tileStyles.tile,
        animStyle,
        {
          backgroundColor: bg,
          borderColor: hasBorder ? borderColor : "transparent",
          borderWidth: hasBorder ? StyleSheet.hairlineWidth * 2 : 0,
        },
      ]}
      accessibilityLabel={
        letter
          ? `${letter}${visibleStatus !== "tbd" && visibleStatus !== "empty" ? ` ${visibleStatus}` : ""}`
          : undefined
      }
    >
      <Text
        style={[
          tileStyles.letter,
          {
            color:
              visibleStatus === "correct" ||
              visibleStatus === "present" ||
              visibleStatus === "absent"
                ? "#ffffff"
                : colors.text,
          },
        ]}
      >
        {letter.toUpperCase()}
      </Text>
    </Animated.View>
  );
}

const tileStyles = StyleSheet.create({
  tile: {
    width: 52,
    height: 52,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 4,
  },
  letter: {
    fontFamily: typography.heading,
    fontSize: 22,
    fontWeight: "700",
    textAlign: "center",
  },
});

// ---------------------------------------------------------------------------
// Tile row
// ---------------------------------------------------------------------------

function TileRow({
  state,
  rowIndex,
  wordLength,
  isFlipping,
}: {
  readonly state: DailyWordState;
  readonly rowIndex: number;
  readonly wordLength: number;
  readonly isFlipping: boolean;
}) {
  const row = state.rows[rowIndex];
  if (!row) return null;

  return (
    <View testID={`daily-word-row-${rowIndex}`} style={rowStyles.row}>
      {row.tiles.map((tile, tileIndex) => (
        <WordTile
          key={tileIndex}
          letter={tile.letter}
          status={tile.status}
          isFlipping={isFlipping}
          flipDelay={tileIndex * TILE_STAGGER_MS}
          testID={`tile-${rowIndex}-${tileIndex}`}
        />
      ))}
      {/* Pad empty tiles if row is shorter than word_length (shouldn't happen) */}
      {Array.from({ length: Math.max(0, wordLength - row.tiles.length) }, (_, i) => (
        <WordTile key={`pad-${i}`} letter="" status="empty" isFlipping={false} flipDelay={0} />
      ))}
    </View>
  );
}

const rowStyles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
  },
});

// ---------------------------------------------------------------------------
// Keyboard
// ---------------------------------------------------------------------------

function WordKeyboard({
  keyboardState,
  language,
  onKey,
}: {
  readonly keyboardState: DailyWordState["keyboard_state"];
  readonly language: string;
  readonly onKey: (key: string) => void;
}) {
  const { t } = useTranslation("daily_word");
  const { colors } = useTheme();

  const rows = language === "hi" ? DEVANAGARI_ROWS : QWERTY_ROWS;

  const KEY_BG: Record<string, string> = {
    correct: "#538d4e",
    present: "#b59f3b",
    absent: "#3a3a3c",
    unused: colors.surfaceAlt ?? "#818384",
  };

  function renderKey(key: string, idx: number) {
    const isAction = key === "Enter" || key === "Delete";
    const letterStatus = keyboardState[key.toLowerCase()] ?? keyboardState[key] ?? "unused";
    const bg = isAction
      ? (colors.surfaceHigh ?? "#818384")
      : (KEY_BG[letterStatus] ?? KEY_BG.unused);
    const label =
      key === "Enter" ? t("keyboard.enter") : key === "Delete" ? t("keyboard.delete") : key;

    return (
      <Pressable
        key={`${key}-${idx}`}
        testID={`daily-word-key-${key.toLowerCase()}`}
        onPress={() => onKey(key)}
        style={[keyStyles.key, isAction && keyStyles.actionKey, { backgroundColor: bg }]}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Text style={[keyStyles.keyText, { color: "#ffffff" }]}>{label}</Text>
      </Pressable>
    );
  }

  return (
    <View style={keyStyles.keyboard}>
      {(rows as ReadonlyArray<ReadonlyArray<string>>).map((row, rowIdx) => (
        <View key={rowIdx} style={keyStyles.keyRow}>
          {row.map((key, keyIdx) => renderKey(key, keyIdx))}
        </View>
      ))}
    </View>
  );
}

const keyStyles = StyleSheet.create({
  keyboard: {
    gap: 6,
    paddingHorizontal: 4,
  },
  keyRow: {
    flexDirection: "row",
    gap: 5,
    justifyContent: "center",
  },
  key: {
    minWidth: 30,
    height: 56,
    paddingHorizontal: 6,
    borderRadius: 6,
    alignItems: "center",
    justifyContent: "center",
  },
  actionKey: {
    minWidth: 52,
  },
  keyText: {
    fontFamily: typography.label,
    fontSize: 13,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
});

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

function Toast({ message }: { readonly message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View
      style={[toastStyles.container, { backgroundColor: colors.text }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={[toastStyles.text, { color: colors.background }]}>{message}</Text>
    </View>
  );
}

const toastStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    zIndex: 100,
    maxWidth: 280,
  },
  text: {
    fontFamily: typography.body,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

/** A finished puzzle is a win or a loss on the games row (#2517), not just "completed". */
function finishedOutcome(state: { won: boolean }) {
  return recordedOutcome(state.won ? "win" : "loss");
}

export default function DailyWordScreen() {
  const { t } = useTranslation("daily_word");
  const { t: tResult } = useTranslation("result");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [state, setState] = useState<DailyWordState | null>(null);
  // Always holds the latest state — read by the async submit, the session
  // abandon paths and the unmount snapshot, none of which can close over `state`.
  const stateRef = useRef<DailyWordState | null>(null);
  stateRef.current = state;
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [winModalVisible, setWinModalVisible] = useState(false);
  const [lossModalVisible, setLossModalVisible] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  // The next puzzle's release time, fixed when the result appears (#2514).
  // msUntilMidnight() jumps to the following midnight once one passes, so a
  // countdown recomputed from it would never reach zero.
  const nextWordAtRef = useRef<number | null>(null);
  const [nextWordReady, setNextWordReady] = useState(false);
  const [copied, setCopied] = useState(false);
  // Play Again couldn't load the next puzzle (offline, server error).
  const [playAgainFailed, setPlayAgainFailed] = useState(false);
  const [flippingRowIndex, setFlippingRowIndex] = useState<number | null>(null);

  // Dev panel (#1293) — all gated by __DEV__; Metro eliminates in production
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [devAnswer, setDevAnswer] = useState<string | null>(null);
  const [devAnswerVisible, setDevAnswerVisible] = useState(false);
  const [devLogEntries, setDevLogEntries] = useState<DevLogEntry[]>([]);
  const [devExpandedIndex, setDevExpandedIndex] = useState<number | null>(null);

  const hasLoadedRef = useRef(false);
  const mountedRef = useRef(true);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = getLanguage();
  const tzOffset = getTimezoneOffset();

  // #2451 — report each puzzle attempt as a per-session game so it earns Arcade
  // XP, shows in Profile history and can be measured by the daily challenge.
  // The session opens on the first accepted guess (not on load), so opening a
  // finished or untouched puzzle creates no row. Abandons on unmount are handled
  // by the hook; the snapshot below gives them the result block.
  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("daily_word");

  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: sessionResult(stateRef.current) }));
  }, [syncSetProgressSnapshot]);

  // ---------------------------------------------------------------------------
  // Countdown timer
  // ---------------------------------------------------------------------------

  const startCountdown = useCallback(
    (untilMs?: number) => {
      if (countdownRef.current) clearInterval(countdownRef.current);
      nextWordAtRef.current = untilMs ?? Date.now() + msUntilMidnight(tzOffset);
      setNextWordReady(false);
      const tick = () => {
        const remaining = Math.max(0, (nextWordAtRef.current ?? 0) - Date.now());
        setCountdown(formatCountdown(remaining));
        if (remaining === 0) {
          setNextWordReady(true);
          if (countdownRef.current) clearInterval(countdownRef.current);
        }
      };
      tick();
      countdownRef.current = setInterval(tick, 1000);
    },
    [tzOffset]
  );

  /**
   * Loads today's puzzle in place of the current one. Fetches before clearing
   * the saved game, so a failure leaves the finished result intact (#2553
   * review). With `requireNewPuzzle`, a server still serving the current
   * puzzle (device clock ahead of the server's) changes nothing: "same".
   */
  const resetToToday = useCallback(
    async ({ requireNewPuzzle = false } = {}): Promise<"ok" | "same" | "failed"> => {
      try {
        const todayMeta = await dailyWordApi.getToday(tzOffset, language);
        if (requireNewPuzzle && todayMeta.puzzle_id === stateRef.current?.puzzle_id) {
          return "same";
        }
        await clearState();
        // The old puzzle's session must close now: left open, the next guess would
        // skip start() and be reported against the old puzzle_id.
        if (syncGetGameId()) {
          syncComplete({ outcome: "abandoned" }, sessionResult(stateRef.current));
        }
        const fresh = initialState(todayMeta.puzzle_id, todayMeta.word_length, language);
        setState(fresh);
        setAnswer(null);
        setWinModalVisible(false);
        setLossModalVisible(false);
        setFlippingRowIndex(null);
        setNextWordReady(false);
        setCopied(false);
        setPlayAgainFailed(false);
        return "ok";
      } catch {
        return "failed";
      }
    },
    [tzOffset, language, syncGetGameId, syncComplete]
  );

  /** How long to wait before retrying when the server hasn't rolled over yet. */
  const NEXT_WORD_RETRY_MS = 60_000;

  const handlePlayAgain = useCallback(async () => {
    setPlayAgainFailed(false);
    const result = await resetToToday({ requireNewPuzzle: true });
    if (!mountedRef.current) return;
    if (result === "same") {
      // The server hasn't moved on yet: count down briefly and try again.
      startCountdown(Date.now() + NEXT_WORD_RETRY_MS);
    } else if (result === "failed") {
      setPlayAgainFailed(true);
    }
  }, [resetToToday, startCountdown]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (countdownRef.current) clearInterval(countdownRef.current);
      if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
      if (flipTimerRef.current) clearTimeout(flipTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!__DEV__) return;
    setDevLogEntries(devLog.list().slice());
    return devLog.subscribe(() => setDevLogEntries(devLog.list().slice()));
  }, []);

  // ---------------------------------------------------------------------------
  // Toast
  // ---------------------------------------------------------------------------

  const showToast = useCallback((message: string) => {
    setToast(message);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToast(null), TOAST_DURATION_MS);
  }, []);

  // ---------------------------------------------------------------------------
  // Mount: load today's puzzle and any saved state
  // ---------------------------------------------------------------------------

  useEffect(() => {
    let alive = true;

    async function load() {
      const dateKey = localDateKey(tzOffset, language);
      try {
        const [todayMeta, saved] = await Promise.all([
          withRetry(() => dailyWordApi.getToday(tzOffset, language))
            .then((meta) => {
              saveTodayMeta(dateKey, meta).catch(() => {});
              return meta;
            })
            // Only serve cached meta on network failures (isNetworkError). HTTP errors
            // such as 401 mean the server is actively denying access — falling
            // back to cache would bypass that.
            .catch((e) => (isNetworkError(e) ? loadTodayMeta(dateKey) : null)),
          loadState(),
        ]);

        if (!alive) return;

        if (!todayMeta) {
          setLoadError(t("error.couldNotLoad"));
          return;
        }

        hasLoadedRef.current = true;

        let gameState: DailyWordState;
        if (saved && saved.puzzle_id === todayMeta.puzzle_id) {
          gameState = saved;
        } else {
          if (saved) await clearState();
          gameState = initialState(todayMeta.puzzle_id, todayMeta.word_length, language);
        }

        setState(gameState);

        if (gameState.is_complete) {
          if (gameState.won) {
            setWinModalVisible(true);
          } else {
            // Fetch answer for loss modal
            dailyWordApi
              .getAnswer(gameState.puzzle_id)
              .then((r) => {
                if (alive) setAnswer(r.answer.toUpperCase());
              })
              .catch(() => {});
            setLossModalVisible(true);
          }
          startCountdown();
        }
      } catch {
        if (alive) setLoadError(t("error.couldNotLoad"));
      } finally {
        if (alive) setLoading(false);
      }
    }

    load();
    return () => {
      alive = false;
    };
    // Run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------------------------------------------------------------------------
  // Persist on every state change after load
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!hasLoadedRef.current || state === null) return;
    saveState(state).catch(() => {});
  }, [state]);

  // ---------------------------------------------------------------------------
  // Input handlers
  // ---------------------------------------------------------------------------

  const handleLetter = useCallback(async (letter: string) => {
    setState((s) => {
      if (!s || s.is_complete) return s;
      return setCurrentRowLetter(s, letter.toLowerCase());
    });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const handleDelete = useCallback(async () => {
    setState((s) => {
      if (!s || s.is_complete) return s;
      return deleteLastLetter(s);
    });
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
  }, []);

  const lastSubmitMsRef = useRef<number>(0);

  const onSubmit = useCallback(async () => {
    const s = stateRef.current;
    if (!s || submitting || s.is_complete) return;

    // Debounce rapid double-taps (e.g. two Enter presses within 500 ms) so they
    // don't consume a rate-limit slot without advancing the game.
    const now = Date.now();
    if (now - lastSubmitMsRef.current < 500) return;
    lastSubmitMsRef.current = now;

    const row = s.rows[s.current_row];
    if (!row) return;

    const guess = row.tiles.map((tile) => tile.letter).join("");
    const filled = row.tiles.filter((tile) => tile.letter !== "").length;

    if (filled < s.word_length) {
      showToast(t("error.tooShort"));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      return;
    }

    // #2197 — a word already on the board must not be submitted again. The
    // server treats a repeat of a recorded guess as a replay (so a re-send
    // after a lost response cannot rob a turn), which means a *deliberate*
    // repeat would advance the board without spending a server-side guess.
    // Six rows and five recorded guesses would then leave the player short of
    // the answer they earned.
    const alreadyGuessed = s.rows
      .slice(0, s.current_row)
      .some((r) => r.submitted && r.tiles.map((tile) => tile.letter).join("") === guess);
    if (alreadyGuessed) {
      showToast(t("error.alreadyGuessed"));
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
      return;
    }

    const _devTs = __DEV__ ? Date.now() : 0;
    const _devBody = __DEV__
      ? { puzzle_id: s.puzzle_id, guess, tz_offset_minutes: tzOffset }
      : undefined;

    setSubmitting(true);
    try {
      const result = await dailyWordApi.submitGuess(s.puzzle_id, guess, tzOffset);
      if (__DEV__)
        devLog.push({
          ts: _devTs,
          method: "POST",
          path: "/daily-word/guess",
          body: _devBody,
          status: 200,
          response: result,
        });
      // The player left while the guess was in flight. useGameSync's unmount
      // cleanup has already run, so opening a session now would leave one that
      // nothing ever completes or abandons.
      if (!mountedRef.current) return;
      const tileStates = result.tiles.map((t) => ({ letter: t.letter, status: t.status }));

      // #2541 — keep the server's count on the state; `guessCount` reads it.
      const afterApply = withServerGuessCount(
        applyServerResult(s, tileStates),
        result.guesses_used
      );
      const won = tileStates.every((tile) => tile.status === "correct");
      // Deliberately the board's rows, not the server's `guesses_remaining`
      // (#2541 review). A 200 can be a replay of a recorded guess — on a
      // puzzle the server has as solved, or on a wiped board — and the 200
      // carries no `solved` flag, so ending the game here would record a
      // loss for a win, or a fresh completion for a finished puzzle. A board
      // that is behind reaches its next guess, which the server refuses with
      // a 403 that the recovery path below handles, guards included.
      const outOfGuesses = !won && afterApply.current_row >= 6;

      if (!syncGetGameId()) {
        syncStart({ puzzle_id: s.puzzle_id }, { puzzle_id: s.puzzle_id, language: s.language });
      }
      syncMarkStarted();

      let finalState = afterApply;
      if (won || outOfGuesses) {
        finalState = markComplete(afterApply, won);
        // Daily Word has no numeric score: final_score stays null and the
        // challenge reads the result block instead.
        syncComplete(
          { finalScore: null, outcome: finishedOutcome(finalState) },
          sessionResult(finalState)
        );
      }

      setState(finalState);

      // Trigger flip animation for the submitted row
      const submittedRowIndex = s.current_row;
      setFlippingRowIndex(submittedRowIndex);

      const totalFlipMs = s.word_length * TILE_STAGGER_MS + FLIP_HALF_MS * 2;
      flipTimerRef.current = setTimeout(async () => {
        setFlippingRowIndex(null);
        if (finalState.is_complete) {
          if (finalState.won) {
            setWinModalVisible(true);
          } else {
            try {
              const answerData = await dailyWordApi.getAnswer(s.puzzle_id);
              setAnswer(answerData.answer.toUpperCase());
            } catch {
              // show modal without answer
            }
            setLossModalVisible(true);
          }
          startCountdown();
        }
      }, totalFlipMs);
    } catch (err) {
      if (__DEV__)
        devLog.push({
          ts: _devTs,
          method: "POST",
          path: "/daily-word/guess",
          body: _devBody,
          status: err instanceof ApiError ? err.status : undefined,
          error: err instanceof ApiError ? err.message : String(err),
        });
      if (err instanceof ApiError && err.status === 422) {
        if (err.message === "not_a_word") {
          showToast(t("error.notAWord"));
        } else if (err.message === "stale_puzzle_id") {
          const recovered = (await resetToToday()) === "ok";
          showToast(recovered ? t("error.stalePuzzle") : t("error.couldNotLoad"));
        } else if (err.message === "wrong_guess_length") {
          showToast(t("error.wrongLength"));
        } else {
          showToast(t("error.couldNotSubmit"));
        }
      } else if (err instanceof ApiError && err.status === 429) {
        showToast(t("error.rateLimited"));
      } else if (
        err instanceof ApiError &&
        err.status === 403 &&
        (err.message === "no_guesses_remaining" || err.message === "already_solved")
      ) {
        // #2197 — the server says this puzzle is finished and the local board
        // disagrees, which happens when a guess was recorded but its response
        // never arrived. Trust the server: close the game out and reveal the
        // answer it will now release, rather than stranding the player on a
        // board that can never complete.
        // Same guard as the success path: the player may have left while the
        // guess was in flight, in which case useGameSync's unmount cleanup has
        // already run and there is nothing left to close out.
        const current = stateRef.current;
        if (mountedRef.current && current) {
          // `already_solved` means the server recorded a winning guess — the
          // player won, and only the response was lost. Marking that a loss
          // would persist won:false and show them the word they had already
          // found.
          const wonIt = err.message === "already_solved";
          // The board is behind the server here by definition — that is why
          // this 403 happened — so its row count is too low. Take the
          // server's count from the refusal (#2541); `guessCount` falls back
          // to the board if an older API sent none.
          const finished = markComplete(
            withServerGuessCount(current, err.body?.guesses_used),
            wonIt
          );

          // Only report a session this visit actually played. `already_solved`
          // is returned for *any* guess on a puzzle this session finished at
          // any earlier time, and the board can be missing independently of
          // the session id — they are separate AsyncStorage keys
          // (`daily_word_state_v1` vs `game_session_id`), and loadState drops
          // only the board on a corrupt payload. Without this guard, opening a
          // wiped board and typing one word would fabricate a completed game
          // for a puzzle finished hours ago, with a guesses_used taken from an
          // empty board — free XP and a free "win in N guesses" goal credit.
          const playedThisVisit = current.rows.some((r) => r.submitted);
          if (playedThisVisit) {
            // The session must be completed, or the unmount cleanup reports
            // outcome:"abandoned" — and abandoned games earn no
            // daily-challenge credit, no streak day and no XP (#2468/#2472).
            if (!syncGetGameId()) {
              syncStart(
                { puzzle_id: current.puzzle_id },
                { puzzle_id: current.puzzle_id, language: current.language }
              );
            }
            syncMarkStarted();
            syncComplete(
              { finalScore: null, outcome: finishedOutcome(finished) },
              sessionResult(finished)
            );
          }

          setState(finished);
          saveState(finished).catch(() => {});

          if (wonIt) {
            setWinModalVisible(true);
          } else {
            try {
              const answerData = await dailyWordApi.getAnswer(finished.puzzle_id);
              if (mountedRef.current) setAnswer(answerData.answer.toUpperCase());
            } catch {
              // Modal still opens; it just won't reveal the word.
            }
            if (!mountedRef.current) return;
            setLossModalVisible(true);
          }
          startCountdown();
        }
      } else {
        showToast(t("error.couldNotSubmit"));
      }
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  }, [
    submitting,
    showToast,
    startCountdown,
    t,
    tzOffset,
    resetToToday,
    syncGetGameId,
    syncStart,
    syncMarkStarted,
    syncComplete,
  ]);

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
      if (outcome !== "copied") return;
      setCopied(true);
      setTimeout(() => {
        if (mountedRef.current) setCopied(false);
      }, 2000);
    } catch {
      // Share dismissed or clipboard unavailable — nothing to report.
    }
  }

  if (loading) {
    return (
      <GameShell title={t("game.title")} requireBack onBack={() => navigation.popToTop()} loading>
        {null}
      </GameShell>
    );
  }

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      onBack={() => navigation.popToTop()}
      error={loadError}
      style={{ paddingBottom: Math.max(insets.bottom, 16) }}
    >
      <View style={styles.body}>
        {/* Toast */}
        <Toast message={toast} />

        {/* Tile grid */}
        {state !== null && (
          <View style={styles.grid} accessibilityLabel="Daily Word board">
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

        {/* Dev panel trigger */}
        {__DEV__ && (
          <Pressable style={styles.devButton} onPress={() => setDevPanelOpen(true)}>
            <Text style={styles.devButtonText}>DEV</Text>
          </Pressable>
        )}
      </View>

      {/* End-of-game result card (#2514) */}
      {state !== null && (
        <GameResultModal
          visible={winModalVisible || lossModalVisible}
          outcome={state.won ? "win" : "loss"}
          eyebrow={t("game.title")}
          subtitle={
            playAgainFailed
              ? t("error.couldNotLoad")
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
                  label: t("result.countdown", { time: countdown }),
                  onPress: () => {},
                  disabled: true,
                }
          }
          secondaryAction={{
            label: copied ? t("result.copied") : t("result.share"),
            accessibilityLabel: t("result.share"),
            onPress: () => void handleShare(),
          }}
          onHome={() => navigation.popToTop()}
          testID="daily-word-result"
        />
      )}

      {/* Dev panel (#1293) */}
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
                <Text style={styles.devPanelTitle}>Dev Panel</Text>

                <Text style={styles.devSectionHeader}>{"── Today's Puzzle ──"}</Text>

                {state !== null && (
                  <>
                    <Text style={[styles.devInfoText, { color: colors.textMuted }]}>
                      {`puzzle_id: ${state.puzzle_id}\nword_length: ${state.word_length}\nlang: ${state.language}`}
                    </Text>

                    <Pressable
                      style={styles.devActionBtn}
                      onPress={async () => {
                        if (devAnswerVisible) {
                          setDevAnswerVisible(false);
                          setDevAnswer(null);
                        } else {
                          try {
                            const r = await dailyWordApi.getAnswer(state.puzzle_id);
                            setDevAnswer(r.answer.toUpperCase());
                            setDevAnswerVisible(true);
                          } catch {
                            setDevAnswer("(failed to fetch)");
                            setDevAnswerVisible(true);
                          }
                        }
                      }}
                    >
                      <Text style={[styles.devBtnText, { color: colors.textMuted }]}>
                        {devAnswerVisible ? "Hide Answer" : "Show Answer"}
                      </Text>
                    </Pressable>

                    {devAnswerVisible && devAnswer !== null && (
                      <Text style={styles.devAnswerText}>{devAnswer}</Text>
                    )}

                    <Pressable
                      style={styles.devPrimaryBtn}
                      onPress={async () => {
                        await resetToToday();
                        setDevAnswer(null);
                        setDevAnswerVisible(false);
                        setDevPanelOpen(false);
                      }}
                    >
                      <Text style={[styles.devBtnText, { color: "#fff" }]}>Reset Game</Text>
                    </Pressable>
                    <Text style={styles.devWarningText}>
                      {
                        "Resets local board only — backend rate limit (20/hr per session+puzzle) still applies"
                      }
                    </Text>
                  </>
                )}

                <Text style={styles.devSectionHeader}>── Game State ──</Text>

                {state !== null && (
                  <Text style={[styles.devInfoText, { color: colors.textMuted }]}>
                    {`row: ${state.current_row}  won: ${state.won}  done: ${state.is_complete}`}
                    {state.rows
                      .filter((r) => r.submitted)
                      .map(
                        (r, i) =>
                          `\n${i + 1}: ${r.tiles.map((tile) => tile.letter).join("")}  [${r.tiles.map((tile) => tile.status[0]).join("")}]`
                      )
                      .join("")}
                  </Text>
                )}

                <Text style={styles.devSectionHeader}>── API Log ──</Text>

                <Pressable
                  style={styles.devActionBtn}
                  onPress={() => {
                    devLog.clear();
                    setDevExpandedIndex(null);
                  }}
                >
                  <Text style={[styles.devBtnText, { color: colors.textMuted }]}>Clear log</Text>
                </Pressable>

                {devLogEntries.length === 0 && (
                  <Text style={[styles.devInfoText, { color: colors.textMuted }]}>
                    No API calls yet
                  </Text>
                )}

                {devLogEntries.map((entry, idx) => (
                  <Pressable
                    key={`${entry.ts}-${entry.method}-${entry.path}`}
                    style={styles.devLogEntry}
                    onPress={() => setDevExpandedIndex(devExpandedIndex === idx ? null : idx)}
                  >
                    <View style={styles.devLogHeader}>
                      <Text
                        style={[
                          styles.devLogStatus,
                          {
                            backgroundColor: entry.error
                              ? "rgba(255,60,60,0.2)"
                              : "rgba(60,200,60,0.2)",
                            color: entry.error ? "#ff6060" : "#60e060",
                          },
                        ]}
                      >
                        {entry.status ?? "err"}
                      </Text>
                      <Text style={styles.devLogPath} numberOfLines={1}>
                        {entry.method} {entry.path.split("?")[0]}
                      </Text>
                      <Text
                        style={[
                          styles.devInfoText,
                          { color: colors.textMuted, flex: 0, fontSize: 10 },
                        ]}
                      >
                        {new Date(entry.ts).toLocaleTimeString()}
                      </Text>
                    </View>
                    {devExpandedIndex === idx && (
                      <Text style={styles.devLogBody}>
                        {JSON.stringify(
                          { body: entry.body, response: entry.response, error: entry.error },
                          null,
                          2
                        )}
                      </Text>
                    )}
                  </Pressable>
                ))}

                <Pressable style={styles.devActionBtn} onPress={() => setDevPanelOpen(false)}>
                  <Text style={[styles.devBtnText, { color: colors.textMuted }]}>Close</Text>
                </Pressable>
              </ScrollView>
            </View>
          </View>
        </Modal>
      )}
    </GameShell>
  );
}

const styles = StyleSheet.create({
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
  // Dev panel styles
  devButton: {
    position: "absolute",
    top: 6,
    left: 6,
    backgroundColor: "rgba(255,128,0,0.85)",
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
    backgroundColor: "rgba(0,0,0,0.7)",
    alignItems: "center",
    justifyContent: "center",
  },
  devPanel: {
    borderRadius: 12,
    padding: 20,
    width: 300,
    maxHeight: "85%",
    borderWidth: 1,
    borderColor: "rgba(255,128,0,0.5)",
  },
  devScrollContent: {
    gap: 12,
    paddingBottom: 4,
  },
  devPanelTitle: {
    color: "rgba(255,128,0,1)",
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 2,
    textAlign: "center",
    textTransform: "uppercase",
  },
  devSectionHeader: {
    color: "rgba(255,128,0,0.7)",
    fontSize: 10,
    letterSpacing: 1,
    textAlign: "center",
    marginTop: 4,
  },
  devActionBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.08)",
  },
  devPrimaryBtn: {
    paddingVertical: 10,
    borderRadius: 8,
    alignItems: "center",
    backgroundColor: "rgba(255,128,0,0.9)",
  },
  devBtnText: {
    fontSize: 13,
    fontWeight: "700",
  },
  devInfoText: {
    fontSize: 11,
    lineHeight: 17,
  },
  devAnswerText: {
    fontSize: 22,
    fontWeight: "900",
    color: "#ffd700",
    textAlign: "center",
    letterSpacing: 6,
  },
  devWarningText: {
    fontSize: 10,
    color: "rgba(255,200,0,0.7)",
    textAlign: "center",
    fontStyle: "italic",
  },
  devLogEntry: {
    backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: 6,
    padding: 8,
    gap: 4,
  },
  devLogHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
  },
  devLogStatus: {
    fontSize: 10,
    fontWeight: "700",
    paddingHorizontal: 4,
    paddingVertical: 1,
    borderRadius: 4,
  },
  devLogPath: {
    fontSize: 11,
    color: "rgba(255,255,255,0.7)",
    flex: 1,
  },
  devLogBody: {
    fontSize: 10,
    color: "rgba(255,255,255,0.5)",
  },
});
