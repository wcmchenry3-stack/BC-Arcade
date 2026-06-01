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
import {
  initialState,
  setCurrentRowLetter,
  deleteLastLetter,
  applyServerResult,
  markComplete,
  buildShareText,
} from "../game/daily_word/engine";
import type { DailyWordState, TileStatus } from "../game/daily_word/types";
import { dailyWordApi } from "../game/daily_word/api";
import { withRetry } from "../game/_shared/withRetry";
import { loadState, saveState, clearState, saveTodayMeta, loadTodayMeta } from "../game/daily_word/storage";
import { ApiError } from "../game/_shared/httpClient";
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

async function copyToClipboard(text: string): Promise<void> {
  if (Platform.OS === "web" && typeof navigator !== "undefined" && navigator.clipboard) {
    await navigator.clipboard.writeText(text);
  }
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
    fontWeight: "900",
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
    fontSize: 11,
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
// Win modal
// ---------------------------------------------------------------------------

function WinModal({
  state,
  countdown,
  onClose,
}: {
  readonly state: DailyWordState;
  readonly countdown: string;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation("daily_word");
  const { colors } = useTheme();
  const [copied, setCopied] = useState(false);

  const guessCount = state.rows.filter((r) => r.submitted).length;

  async function handleShare() {
    const text = buildShareText(state, DEEP_LINK);
    try {
      await copyToClipboard(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // ignore
    }
  }

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      accessibilityViewIsModal
      onRequestClose={onClose}
    >
      <Pressable style={modalStyles.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View
            style={[
              modalStyles.card,
              { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
            ]}
          >
            <Pressable
              style={modalStyles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("modal.close")}
            >
              <Text style={[modalStyles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
            <Text style={[modalStyles.title, { color: colors.text }]} accessibilityRole="header">
              {t("result.win.title")}
            </Text>
            <Text style={[modalStyles.body, { color: colors.textMuted }]}>
              {t("result.win.guesses", { count: guessCount })}
            </Text>
            <Pressable
              onPress={handleShare}
              style={[modalStyles.primaryBtn, { backgroundColor: colors.accent }]}
              accessibilityRole="button"
              accessibilityLabel={t("result.win.share")}
            >
              <Text style={[modalStyles.primaryBtnText, { color: "#ffffff" }]}>
                {copied ? t("result.win.copied") : t("result.win.share")}
              </Text>
            </Pressable>
            <Text style={[modalStyles.countdown, { color: colors.textMuted }]}>
              {t("result.win.countdown", { time: countdown })}
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Loss modal
// ---------------------------------------------------------------------------

function LossModal({
  answer,
  countdown,
  onClose,
}: {
  readonly answer: string | null;
  readonly countdown: string;
  readonly onClose: () => void;
}) {
  const { t } = useTranslation("daily_word");
  const { colors } = useTheme();

  return (
    <Modal
      visible
      transparent
      animationType="fade"
      accessibilityViewIsModal
      onRequestClose={onClose}
    >
      <Pressable style={modalStyles.overlay} onPress={onClose}>
        <Pressable onPress={() => {}}>
          <View
            style={[
              modalStyles.card,
              { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
            ]}
          >
            <Pressable
              style={modalStyles.closeBtn}
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel={t("modal.close")}
            >
              <Text style={[modalStyles.closeBtnText, { color: colors.textMuted }]}>✕</Text>
            </Pressable>
            <Text style={[modalStyles.title, { color: colors.text }]} accessibilityRole="header">
              {t("result.loss.title")}
            </Text>
            {answer !== null && (
              <Text style={[modalStyles.body, { color: colors.text }]}>
                {t("result.loss.answer", { answer })}
              </Text>
            )}
            <Text style={[modalStyles.body, { color: colors.textMuted }]}>
              {t("result.loss.countdown", { time: countdown })}
            </Text>
            <Text style={[modalStyles.nextWordLabel, { color: colors.textMuted }]}>
              {"Next word in "}
              <Text style={{ color: colors.text }}>{countdown}</Text>
            </Text>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000bf",
  },
  card: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 28,
    alignItems: "center",
    width: "86%",
    maxWidth: 340,
    gap: 10,
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: 0.5,
    textAlign: "center",
  },
  body: {
    fontFamily: typography.body,
    fontSize: 15,
    textAlign: "center",
  },
  primaryBtn: {
    paddingHorizontal: 28,
    paddingVertical: 12,
    borderRadius: 999,
    marginTop: 4,
    alignItems: "center",
    minWidth: 160,
  },
  primaryBtnText: {
    fontFamily: typography.label,
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  countdown: {
    fontFamily: typography.body,
    fontSize: 13,
    textAlign: "center",
    marginTop: 4,
  },
  nextWordLabel: {
    fontFamily: typography.body,
    fontSize: 14,
    textAlign: "center",
  },
  closeBtn: {
    position: "absolute",
    top: 12,
    right: 12,
    width: 32,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 1,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: "600",
  },
});

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export default function DailyWordScreen() {
  const { t } = useTranslation("daily_word");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [state, setState] = useState<DailyWordState | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [winModalVisible, setWinModalVisible] = useState(false);
  const [lossModalVisible, setLossModalVisible] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [countdown, setCountdown] = useState("");
  const [flippingRowIndex, setFlippingRowIndex] = useState<number | null>(null);

  // Dev panel (#1293) — all gated by __DEV__; Metro eliminates in production
  const [devPanelOpen, setDevPanelOpen] = useState(false);
  const [devAnswer, setDevAnswer] = useState<string | null>(null);
  const [devAnswerVisible, setDevAnswerVisible] = useState(false);
  const [devLogEntries, setDevLogEntries] = useState<DevLogEntry[]>([]);
  const [devExpandedIndex, setDevExpandedIndex] = useState<number | null>(null);

  const hasLoadedRef = useRef(false);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const language = getLanguage();
  const tzOffset = getTimezoneOffset();

  // ---------------------------------------------------------------------------
  // Countdown timer
  // ---------------------------------------------------------------------------

  const startCountdown = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current);
    const tick = () => setCountdown(formatCountdown(msUntilMidnight(tzOffset)));
    tick();
    countdownRef.current = setInterval(tick, 1000);
  }, [tzOffset]);

  const resetToToday = useCallback(async (): Promise<boolean> => {
    try {
      await clearState();
      const todayMeta = await dailyWordApi.getToday(tzOffset, language);
      const fresh = initialState(todayMeta.puzzle_id, todayMeta.word_length, language);
      setState(fresh);
      setAnswer(null);
      setWinModalVisible(false);
      setLossModalVisible(false);
      setFlippingRowIndex(null);
      return true;
    } catch {
      return false;
    }
  }, [tzOffset, language]);

  useEffect(() => {
    return () => {
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
            // Only serve cached meta on network failures (TypeError). HTTP errors
            // such as 401 mean the server is actively denying access — falling
            // back to cache would bypass that.
            .catch((e) => (e instanceof TypeError ? loadTodayMeta(dateKey) : null)),
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

  // Use a ref to always access latest state in the async submit
  const stateRef = useRef<DailyWordState | null>(null);
  stateRef.current = state;

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
      const tileStates = result.tiles.map((t) => ({ letter: t.letter, status: t.status }));

      const afterApply = applyServerResult(s, tileStates);
      const won = tileStates.every((tile) => tile.status === "correct");
      const outOfGuesses = !won && afterApply.current_row >= 6;

      let finalState = afterApply;
      if (won || outOfGuesses) {
        finalState = markComplete(afterApply, won);
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
          const recovered = await resetToToday();
          showToast(recovered ? t("error.stalePuzzle") : t("error.couldNotLoad"));
        } else if (err.message === "wrong_guess_length") {
          showToast(t("error.wrongLength"));
        } else {
          showToast(t("error.couldNotSubmit"));
        }
      } else if (err instanceof ApiError && err.status === 429) {
        showToast(t("error.rateLimited"));
      } else {
        showToast(t("error.couldNotSubmit"));
      }
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy).catch(() => {});
    } finally {
      setSubmitting(false);
    }
  }, [submitting, showToast, startCountdown, t, tzOffset, resetToToday]);

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

      {/* Win modal */}
      {state !== null && winModalVisible && (
        <WinModal state={state} countdown={countdown} onClose={() => setWinModalVisible(false)} />
      )}

      {/* Loss modal */}
      {lossModalVisible && (
        <LossModal
          answer={answer}
          countdown={countdown}
          onClose={() => setLossModalVisible(false)}
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
