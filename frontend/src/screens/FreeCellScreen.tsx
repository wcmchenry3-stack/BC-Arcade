import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import FreeCellBoard from "../components/freecell/FreeCellBoard";
import { CARD_WIDTH, CARD_HEIGHT } from "../components/freecell/FreeCellSlot";
import { FreeCellFoundationAnimation } from "../components/freecell/FreeCellFoundationAnimation";
import { FreeCellGameWinAnimation } from "../components/freecell/FreeCellGameWinAnimation";
import {
  dealGame,
  applyMove,
  undoMove,
  applyHint,
  getHintMoves,
  canAutoComplete,
  autoComplete,
} from "../game/freecell/engine";
import type { FreeCellState, Move } from "../game/freecell/types";
import {
  clearGame,
  loadGame,
  saveGame,
  loadStats,
  saveStats,
  type FreeCellStats,
} from "../game/freecell/storage";
import { freecellApi, type ScoreEntry } from "../game/freecell/api";
import { useGameEvents } from "../game/_shared/useGameEvents";
import { useSound } from "../game/_shared/useSound";
import { FREECELL_SOUNDS } from "../game/freecell/sounds";
import { CardSizeContext, useResponsiveCardSize } from "../game/_shared/CardSizeContext";
import { useNetwork } from "../game/_shared/NetworkContext";
import { OfflineBanner } from "../components/shared/OfflineBanner";

const AUTO_STEP_MS = 120;
const TABLEAU_COLS = 8;
const COL_GAP = 2;
const SCREEN_H_PADDING = 24;
const MAX_NAME_LENGTH = 32;

export default function FreeCellScreen() {
  const { t } = useTranslation("freecell");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [state, setState] = useState<FreeCellState | null>(null);
  const [loading, setLoading] = useState(true);
  const statsRef = useRef<FreeCellStats>({ bestMoves: 0, gamesPlayed: 0, gamesWon: 0 });

  const hasLoadedRef = useRef(false);
  const isMountedRef = useRef(true);
  const autoCompletingRef = useRef(false);
  const autoStepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [autoCompleting, setAutoCompleting] = useState(false);
  /** Guards against double-counting a win within a single game session. */
  const winRecordedRef = useRef(false);
  const prevCompleteRef = useRef(false);

  const [showFoundation, setShowFoundation] = useState(false);
  const [showGameWin, setShowGameWin] = useState(false);
  const [showNoMovesBanner, setShowNoMovesBanner] = useState(false);

  const { play: playCardPlace } = useSound("freecell.cardPlace", FREECELL_SOUNDS, 0.4);
  const { play: playSupermove } = useSound("freecell.supermove", FREECELL_SOUNDS, 0.5);
  const { play: playFoundationComplete } = useSound("freecell.foundationComplete", FREECELL_SOUNDS);
  const { play: playGameWin } = useSound("freecell.gameWin", FREECELL_SOUNDS);

  const startAutoComplete = useCallback((fromState: FreeCellState) => {
    if (autoCompletingRef.current) return;
    if (!canAutoComplete(fromState)) return;
    autoCompletingRef.current = true;
    setAutoCompleting(true);

    const step = (current: FreeCellState) => {
      if (!isMountedRef.current) return;
      const next = autoComplete(current);
      if (next === current || next.isComplete) {
        setState(next === current ? current : next);
        autoCompletingRef.current = false;
        setAutoCompleting(false);
        return;
      }
      setState(next);
      autoStepTimeoutRef.current = setTimeout(() => step(next), AUTO_STEP_MS);
    };

    autoStepTimeoutRef.current = setTimeout(() => step(fromState), AUTO_STEP_MS);
  }, []);

  // Track mount status for async safety
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (autoStepTimeoutRef.current !== null) clearTimeout(autoStepTimeoutRef.current);
    };
  }, []);

  // Mount: resume saved game or deal fresh, load stats
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats()]).then(([saved, savedStats]) => {
      if (!alive) return;
      hasLoadedRef.current = true;
      const initial = saved ?? dealGame();
      setState(initial);
      // Suppress re-counting a win when resuming an already-won game.
      if (saved?.isComplete) winRecordedRef.current = true;
      if (!saved) {
        // First deal (not a resume) — count as a game started.
        const withPlay = { ...savedStats, gamesPlayed: savedStats.gamesPlayed + 1 };
        statsRef.current = withPlay;
        saveStats(withPlay).catch(() => {});
      } else {
        statsRef.current = savedStats;
      }
      setLoading(false);
      startAutoComplete(initial);
    });
    return () => {
      alive = false;
    };
  }, [startAutoComplete]);

  // Persist on every state change once the mount load has resolved
  useEffect(() => {
    if (!hasLoadedRef.current || state === null) return;
    saveGame(state).catch(() => {});
  }, [state]);

  useGameEvents(
    state?.events,
    {
      cardPlace: () => {
        playCardPlace();
        setShowNoMovesBanner(false);
      },
      supermove: () => {
        playSupermove();
        setShowNoMovesBanner(false);
      },
      foundationComplete: () => {
        playFoundationComplete();
        setShowFoundation(true);
        setShowNoMovesBanner(false);
      },
      gameWin: () => {
        playGameWin();
        setShowGameWin(true);
        setShowNoMovesBanner(false);
      },
      noMovesAvailable: () => setShowNoMovesBanner(true),
    },
    () => setState((prev) => (prev === null ? null : { ...prev, events: [] }))
  );

  // Handle win: update stats and clear saved game
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      clearGame().catch(() => {});
      if (!winRecordedRef.current) {
        winRecordedRef.current = true;
        const finalMoves = state.moveCount;
        const curr = statsRef.current;
        const updated: FreeCellStats = {
          ...curr,
          gamesWon: curr.gamesWon + 1,
          bestMoves:
            curr.bestMoves === 0 || finalMoves < curr.bestMoves ? finalMoves : curr.bestMoves,
        };
        statsRef.current = updated;
        saveStats(updated).catch(() => {});
      }
    }
    prevCompleteRef.current = state.isComplete;
  }, [state]);

  const handleMove = useCallback(
    (move: Move) => {
      if (state === null || autoCompletingRef.current) return;
      const next = applyMove(state, move);
      if (next === state) return;
      setState(next);
      startAutoComplete(next);
    },
    [state, startAutoComplete]
  );

  const handleUndo = useCallback(() => {
    if (state === null || state.undoStack.length === 0) return;
    setShowNoMovesBanner(false);
    setState(undoMove(state));
  }, [state]);

  const handleHint = useCallback(() => {
    if (state === null || state.isComplete) return;
    if (getHintMoves(state).length === 0) {
      setShowNoMovesBanner(true);
      return;
    }
    setState(applyHint(state));
  }, [state]);

  const handleNewGame = useCallback(() => {
    clearGame().catch(() => {});
    setState(dealGame());
    const updated = { ...statsRef.current, gamesPlayed: statsRef.current.gamesPlayed + 1 };
    statsRef.current = updated;
    saveStats(updated).catch(() => {});
    winRecordedRef.current = false;
  }, []);

  const undoDisabled =
    state === null || state.undoStack.length === 0 || state.isComplete || autoCompleting;
  const hintDisabled = state === null || state.isComplete || autoCompleting;
  const cardSize = useResponsiveCardSize(
    CARD_WIDTH,
    CARD_HEIGHT,
    TABLEAU_COLS,
    COL_GAP,
    SCREEN_H_PADDING
  );

  return (
    <GameShell
      title={t("freecell:game.title")}
      requireBack
      loading={loading}
      onBack={() => navigation.popToTop()}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 12),
        paddingRight: Math.max(insets.right, 12),
      }}
      onNewGame={handleNewGame}
      rightSlot={
        <View style={styles.headerBtnRow}>
          <Pressable
            testID="freecell-hint-button"
            onPress={handleHint}
            disabled={hintDisabled}
            style={[
              styles.headerBtn,
              { borderColor: colors.bonus, opacity: hintDisabled ? 0.4 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t("freecell:action.hint")}
            accessibilityState={{ disabled: hintDisabled }}
          >
            <Text style={[styles.headerBtnText, { color: colors.bonus }]}>
              {t("freecell:action.hint")}
            </Text>
          </Pressable>
          <Pressable
            onPress={handleUndo}
            disabled={undoDisabled}
            style={[
              styles.headerBtn,
              { borderColor: colors.accent, opacity: undoDisabled ? 0.4 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t("freecell:action.undo")}
            accessibilityState={{ disabled: undoDisabled }}
          >
            <Text style={[styles.headerBtnText, { color: colors.accent }]}>
              {t("freecell:action.undo")}
            </Text>
          </Pressable>
        </View>
      }
    >
      {state !== null && (
        <CardSizeContext.Provider value={cardSize}>
          <View style={styles.body}>
            <View style={styles.hudRow} accessibilityRole="summary">
              <Text style={[styles.hudTitle, { color: colors.text }]}>
                {t("freecell:game.title")}
              </Text>
              <Text
                style={[styles.hudText, { color: colors.textMuted }]}
                accessibilityLabel={t("freecell:score.moves", { moves: state.moveCount })}
              >
                {t("freecell:score.moves", { moves: state.moveCount })}
              </Text>
            </View>

            <View
              testID="freecell-board"
              style={styles.boardWrap}
              accessibilityLabel={t("freecell:a11y.boardRegion")}
            >
              <FreeCellBoard state={state} onMove={handleMove} />
            </View>

            {showNoMovesBanner && (
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
                <Pressable
                  onPress={handleUndo}
                  disabled={undoDisabled}
                  style={[
                    styles.noMovesUndoBtn,
                    { borderColor: colors.accent, opacity: undoDisabled ? 0.4 : 1 },
                  ]}
                  accessibilityRole="button"
                  accessibilityLabel={t("freecell:action.undo")}
                >
                  <Text style={[styles.headerBtnText, { color: colors.accent }]}>
                    {t("freecell:action.undo")}
                  </Text>
                </Pressable>
              </View>
            )}
          </View>
        </CardSizeContext.Provider>
      )}

      {state?.isComplete === true && (
        <WinModal
          moves={state.moveCount}
          onNewGame={handleNewGame}
          onGoHome={() => navigation.popToTop()}
        />
      )}

      <FreeCellFoundationAnimation
        visible={showFoundation}
        onAnimationEnd={() => setShowFoundation(false)}
      />
      <FreeCellGameWinAnimation visible={showGameWin} onDismiss={() => setShowGameWin(false)} />
    </GameShell>
  );
}

// ---------------------------------------------------------------------------
// Win modal — name entry + score POST with retry
// ---------------------------------------------------------------------------

function WinModal({
  moves,
  onNewGame,
  onGoHome,
}: {
  readonly moves: number;
  readonly onNewGame: () => void;
  readonly onGoHome: () => void;
}) {
  const { t } = useTranslation("freecell");
  const { colors } = useTheme();
  const { isOnline, isInitialized } = useNetwork();

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<ScoreEntry | null>(null);
  const [error, setError] = useState<string | null>(null);

  const offline = isInitialized && !isOnline;

  const gradient: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

  const trimmed = name.trim();
  const canSubmit = !submitting && !offline && trimmed.length > 0;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const entry = await freecellApi.submitScore(trimmed, moves);
      setSubmitted(entry);
    } catch {
      setError(t("freecell:error.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = error ? t("freecell:error.submitRetry") : t("freecell:action.submitScore");

  return (
    <Modal visible transparent animationType="fade" accessibilityViewIsModal>
      <View style={styles.modalOverlay}>
        <View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]} accessibilityRole="header">
            {t("win.title")}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>
            {t("win.moves", { moves })}
          </Text>

          {submitted === null ? (
            <>
              <TextInput
                style={[
                  styles.nameInput,
                  {
                    backgroundColor: colors.surfaceAlt,
                    borderColor: colors.border,
                    color: colors.text,
                  },
                ]}
                placeholder={t("freecell:win.namePlaceholder")}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                maxLength={MAX_NAME_LENGTH}
                editable={!submitting}
                accessibilityLabel={t("freecell:win.nameLabel")}
                accessibilityHint={t("freecell:win.nameHint")}
              />
              {offline ? (
                <OfflineBanner />
              ) : (
                error !== null && (
                  <Text
                    style={[styles.winError, { color: colors.error }]}
                    accessibilityLiveRegion="assertive"
                    accessibilityRole="alert"
                  >
                    {error}
                  </Text>
                )
              )}
              <Pressable
                style={[styles.modalPrimary, gradient, !canSubmit && styles.modalPrimaryDisabled]}
                onPress={handleSubmit}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel={submitLabel}
                accessibilityState={{ disabled: !canSubmit, busy: submitting }}
                testID="freecell-submit-score-button"
              >
                {submitting ? (
                  <ActivityIndicator color={colors.textOnAccent} />
                ) : (
                  <Text style={[styles.modalPrimaryText, { color: colors.textOnAccent }]}>
                    {submitLabel}
                  </Text>
                )}
              </Pressable>
            </>
          ) : (
            <Text
              style={[styles.winSaved, { color: colors.bonus }]}
              accessibilityLiveRegion="polite"
            >
              {submitted.rank <= 10
                ? t("freecell:win.rank", { rank: submitted.rank })
                : t("freecell:win.rankUnranked")}
            </Text>
          )}

          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onNewGame}
            accessibilityRole="button"
            accessibilityLabel={t("freecell:action.newGame")}
            testID="freecell-new-game-button"
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("freecell:action.newGame")}
            </Text>
          </Pressable>

          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onGoHome}
            accessibilityRole="button"
            accessibilityLabel={t("freecell:action.goHome")}
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("freecell:action.goHome")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
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
  headerBtn: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    minHeight: 32,
    justifyContent: "center",
  },
  headerBtnText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  noMovesBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    gap: 12,
  },
  noMovesText: {
    flex: 1,
    fontSize: 13,
    fontWeight: "600",
  },
  noMovesUndoBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    borderWidth: 1,
    justifyContent: "center",
  },
  hudRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  hudTitle: {
    fontFamily: typography.heading,
    fontSize: 14,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  hudText: {
    fontFamily: typography.body,
    fontSize: 12,
    letterSpacing: 0.5,
  },
  boardWrap: {
    alignSelf: "stretch",
    alignItems: "center",
  },
  modalOverlay: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#000000bf",
  },
  modalCard: {
    borderRadius: 20,
    borderWidth: 1,
    padding: 24,
    alignItems: "center",
    width: "86%",
    maxWidth: 360,
  },
  modalTitle: {
    fontFamily: typography.heading,
    fontSize: 20,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 10,
    textAlign: "center",
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 20,
    textAlign: "center",
  },
  modalPrimary: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    marginBottom: 10,
    alignItems: "center",
    minWidth: 180,
  },
  modalPrimaryText: {
    fontSize: 14,
    fontWeight: "800",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  modalSecondary: {
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    borderWidth: 1,
  },
  modalSecondaryText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
  },
  nameInput: {
    width: "100%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    marginBottom: 12,
  },
  modalPrimaryDisabled: {
    opacity: 0.5,
  },
  winError: {
    fontSize: 13,
    marginBottom: 10,
    textAlign: "center",
  },
  winSaved: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
});
