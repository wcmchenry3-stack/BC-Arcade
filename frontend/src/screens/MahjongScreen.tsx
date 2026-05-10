/**
 * MahjongScreen — Mahjong Solitaire with full lifecycle wiring (#874).
 *
 * Concerns:
 *   1. Game logic — dispatches engine functions (selectTile, shuffleBoard,
 *      undoMove) in response to GameCanvas callbacks; engine is pure and
 *      replaces state wholesale on every transition.
 *   2. Persistence — AsyncStorage save/resume on every mutation.
 *   3. Instrumentation — useGameSync session started on first tile tap,
 *      completed on win, abandoned on back-navigation.
 *   4. Score submission — scoreQueue.enqueue("mahjong", …) on win; never
 *      calls mahjongApi.submitScore directly.
 *   5. Audio + animations (#914) — SFX on every game event, lo-fi bg music,
 *      MatchBurst / DeadlockShake / ShufflePulse / WinModal spring.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  ViewStyle,
} from "react-native";
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withTiming,
  withSpring,
  withSequence,
  withDelay,
  runOnJS,
  Easing,
} from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import { HomeStackParamList } from "../../App";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import { OfflineBanner } from "../components/shared/OfflineBanner";
import GameCanvas from "../components/mahjong/GameCanvas";
import { useMahjongCanvasLayout } from "../game/mahjong/layout";
import type { MahjongLayout } from "../game/mahjong/layout";
import { createGame, elapsedMs, selectTile, shuffleBoard, undoMove } from "../game/mahjong/engine";
import { TURTLE_LAYOUT } from "../game/mahjong/layouts/turtle";
import type { MahjongState, SlotTile } from "../game/mahjong/types";
import {
  clearGame,
  loadGame,
  loadStats,
  saveGame,
  saveStats,
  type MahjongStats,
} from "../game/mahjong/storage";
import { useMahjongScoreboard } from "../game/mahjong/MahjongScoreboardContext";
import { useMahjongAudio } from "../game/mahjong/useMahjongAudio";
import { scoreQueue } from "../game/_shared/scoreQueue";
import { useGameSync } from "../game/_shared/useGameSync";
import { useNetwork } from "../game/_shared/NetworkContext";

const MAX_NAME_LENGTH = 32;

// ---------------------------------------------------------------------------
// Tile center — used by FlyingPair to compute animation start/end positions
// ---------------------------------------------------------------------------

function tileCenter(tile: SlotTile, l: MahjongLayout): { cx: number; cy: number } {
  return {
    cx: l.padX + (tile.col / 2) * l.tileWidth + tile.layer * l.layerDx + l.tileWidth / 2,
    cy: l.padY + tile.row * l.tileHeight - tile.layer * l.layerDy + l.tileHeight / 2,
  };
}

// ---------------------------------------------------------------------------
// FlyingPair — two matched tiles slide toward each other then burst and fade
// ---------------------------------------------------------------------------

interface FlyingPairData {
  id: string;
  tile1: SlotTile;
  tile2: SlotTile;
}

const BURST_R = 22;

function FlyingPair({
  tile1,
  tile2,
  layout,
  color,
  onDone,
}: FlyingPairData & { layout: MahjongLayout; color: string; onDone: () => void }) {
  const { cx: c1x, cy: c1y } = tileCenter(tile1, layout);
  const { cx: c2x, cy: c2y } = tileCenter(tile2, layout);
  const midX = (c1x + c2x) / 2;
  const midY = (c1y + c2y) / 2;

  const t1cx = useSharedValue(c1x);
  const t1cy = useSharedValue(c1y);
  const t2cx = useSharedValue(c2x);
  const t2cy = useSharedValue(c2y);
  const pairOpacity = useSharedValue(1);
  const burstScaleVal = useSharedValue(0);
  const burstOpacity = useSharedValue(0);

  useEffect(() => {
    const moveCfg = { duration: 220, easing: Easing.out(Easing.quad) };
    t1cx.value = withTiming(midX, moveCfg);
    t1cy.value = withTiming(midY, moveCfg);
    t2cx.value = withTiming(midX, moveCfg);
    t2cy.value = withTiming(midY, moveCfg);
    pairOpacity.value = withSequence(
      withTiming(1, { duration: 180 }),
      withTiming(0, { duration: 100 }, (finished) => {
        if (finished) runOnJS(onDone)();
      })
    );
    burstScaleVal.value = withDelay(180, withSpring(1.5, { damping: 8, stiffness: 60 }));
    burstOpacity.value = withSequence(
      withDelay(180, withTiming(0.85, { duration: 40 })),
      withTiming(0, { duration: 80 })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tw = layout.tileWidth - layout.sideWidth;
  const th = layout.tileHeight - layout.sideWidth;

  const tile1Style = useAnimatedStyle(() => ({
    position: "absolute",
    left: t1cx.value - tw / 2,
    top: t1cy.value - th / 2,
    width: tw,
    height: th,
    borderRadius: 2,
    backgroundColor: color,
    borderWidth: 1.5,
    borderColor: "#ffd700",
    opacity: pairOpacity.value,
  }));

  const tile2Style = useAnimatedStyle(() => ({
    position: "absolute",
    left: t2cx.value - tw / 2,
    top: t2cy.value - th / 2,
    width: tw,
    height: th,
    borderRadius: 2,
    backgroundColor: color,
    borderWidth: 1.5,
    borderColor: "#ffd700",
    opacity: pairOpacity.value,
  }));

  const burstStyle = useAnimatedStyle(() => ({
    position: "absolute",
    left: midX - BURST_R,
    top: midY - BURST_R,
    width: BURST_R * 2,
    height: BURST_R * 2,
    borderRadius: BURST_R,
    backgroundColor: color,
    transform: [{ scale: burstScaleVal.value }],
    opacity: burstOpacity.value,
  }));

  return (
    <>
      <Animated.View pointerEvents="none" style={tile1Style} />
      <Animated.View pointerEvents="none" style={tile2Style} />
      <Animated.View pointerEvents="none" style={burstStyle} />
    </>
  );
}

// ---------------------------------------------------------------------------
// MahjongScreen
// ---------------------------------------------------------------------------

export default function MahjongScreen() {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const layout = useMahjongCanvasLayout();

  const [state, setState] = useState<MahjongState | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<MahjongStats>({
    bestScore: 0,
    bestTimeMs: 0,
    gamesPlayed: 0,
    gamesWon: 0,
  });

  // Animation state
  const [flyingPairs, setFlyingPairs] = useState<FlyingPairData[]>([]);
  const [reduceMotion, setReduceMotion] = useState(false);
  const boardShakeX = useSharedValue(0);
  const boardOpacity = useSharedValue(1);
  const boardAnimStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boardShakeX.value }],
    opacity: boardOpacity.value,
  }));

  const hasLoadedRef = useRef(false);
  const stateRef = useRef<MahjongState | null>(null);
  const winRecordedRef = useRef(false);
  const prevCompleteRef = useRef(false);
  // Tracks previous state for audio/animation event detection.
  const prevAudioStateRef = useRef<MahjongState | null>(null);
  // Stable refs to audio callbacks — avoids re-running the detection effect when
  // play functions change reference (they're recreated each render by useSound).
  const audioCallbacksRef = useRef({
    playTileSelect: () => {},
    playTileMatch: () => {},
    playShuffle: () => {},
    playWin: () => {},
    playDeadlock: () => {},
  });

  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
  } = useGameSync("mahjong");

  const { setSnapshot: setScoreboardSnapshot } = useMahjongScoreboard();

  // Audio
  const musicActive = state !== null && !state.isComplete && !state.isDeadlocked;
  const { playTileSelect, playTileMatch, playShuffle, playWin, playDeadlock } =
    useMahjongAudio(musicActive);

  // Keep audio callback refs up-to-date each render.
  useEffect(() => {
    audioCallbacksRef.current = {
      playTileSelect,
      playTileMatch,
      playShuffle,
      playWin,
      playDeadlock,
    };
  });

  // Reduce motion preference.
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Scoreboard snapshot — updated on every state change.
  useEffect(() => {
    if (!state) return;
    const elapsed = elapsedMs(state, Date.now());
    setScoreboardSnapshot({
      score: state.score,
      pairsRemoved: state.pairsRemoved,
      shufflesLeft: state.shufflesLeft,
      elapsedMs: elapsed,
      hasGame: true,
      bestScore: stats.bestScore,
      bestTimeMs: stats.bestTimeMs,
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
    });
  }, [state, stats, setScoreboardSnapshot]);

  // Mount: restore saved game or deal fresh.
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats()]).then(([saved, savedStats]) => {
      if (!alive) return;
      hasLoadedRef.current = true;
      if (saved !== null) {
        setState(saved);
        if (saved.isComplete) winRecordedRef.current = true;
      } else {
        setState(createGame(TURTLE_LAYOUT));
        setStats((prev) => {
          const updated = { ...prev, gamesPlayed: prev.gamesPlayed + 1 };
          saveStats(updated).catch(() => {});
          return updated;
        });
      }
      setStats(savedStats);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // Persist on every state change after mount load resolves.
  useEffect(() => {
    stateRef.current = state;
    if (!hasLoadedRef.current || state === null) return;
    saveGame(state).catch(() => {});
  }, [state]);

  // Audio + animation event detection — compare previous vs current state.
  useEffect(() => {
    const prev = prevAudioStateRef.current;
    prevAudioStateRef.current = state;
    if (!prev || !state) return;

    const {
      playTileSelect: pSelect,
      playTileMatch: pMatch,
      playShuffle: pShuffle,
      playWin: pWin,
      playDeadlock: pDead,
    } = audioCallbacksRef.current;

    if (state.tiles.length < prev.tiles.length) {
      pMatch();
      if (!reduceMotion) {
        const removed = prev.tiles.filter((t) => !state.tiles.some((nt) => nt.id === t.id));
        if (removed.length >= 2) {
          setFlyingPairs((existing) => [
            ...existing,
            { id: `${Date.now()}`, tile1: removed[0]!, tile2: removed[1]! },
          ]);
        }
      }
    } else if (state.selected !== null) {
      pSelect();
    }

    if (state.shufflesLeft < prev.shufflesLeft) {
      pShuffle();
      if (!reduceMotion) {
        boardOpacity.value = withSequence(
          withTiming(0.35, { duration: 180 }),
          withTiming(1, { duration: 180 })
        );
      }
    }

    if (state.isComplete && !prev.isComplete) {
      pWin();
    }

    if (state.isDeadlocked && !prev.isDeadlocked) {
      pDead();
      if (!reduceMotion) {
        boardShakeX.value = withSequence(
          withTiming(8, { duration: 60 }),
          withTiming(-8, { duration: 60 }),
          withTiming(6, { duration: 60 }),
          withTiming(-6, { duration: 60 }),
          withTiming(4, { duration: 60 }),
          withTiming(-4, { duration: 60 }),
          withTiming(0, { duration: 60 })
        );
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Win lifecycle: complete sync session, record stats.
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      syncComplete(
        { finalScore: state.score, outcome: "completed", durationMs: state.accumulatedMs },
        { final_score: state.score, outcome: "completed", pairs: state.pairsRemoved }
      );
      clearGame().catch(() => {});
      if (!winRecordedRef.current) {
        winRecordedRef.current = true;
        const finalMs = state.accumulatedMs;
        const finalScore = state.score;
        setStats((prev) => {
          const updated: MahjongStats = {
            ...prev,
            gamesWon: prev.gamesWon + 1,
            bestScore: finalScore > prev.bestScore ? finalScore : prev.bestScore,
            bestTimeMs:
              prev.bestTimeMs === 0 || finalMs < prev.bestTimeMs ? finalMs : prev.bestTimeMs,
          };
          saveStats(updated).catch(() => {});
          return updated;
        });
      }
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete]);

  // Abandon on back-navigation.
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      if (!syncGetGameId()) return;
      const s = stateRef.current;
      if (s?.isComplete) return;
      syncComplete(
        { outcome: "abandoned", finalScore: s?.score ?? 0, durationMs: 0 },
        { outcome: "abandoned" }
      );
    });
    return unsub;
  }, [navigation, syncComplete, syncGetGameId]);

  const ensureSyncStarted = useCallback(
    (s: MahjongState) => {
      if (syncGetGameId()) return;
      syncStart({ layout: "turtle" });
      syncMarkStarted();
      if (s.pairsRemoved === 0 && !hasLoadedRef.current) return;
    },
    [syncGetGameId, syncStart, syncMarkStarted]
  );

  const handleTilePress = useCallback(
    (tileId: number) => {
      setState((prev) => {
        if (!prev) return prev;
        const next = selectTile(prev, tileId);
        if (next === prev) return prev;
        ensureSyncStarted(next);
        return next;
      });
    },
    [ensureSyncStarted]
  );

  const handleShuffle = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      const next = shuffleBoard(prev);
      if (next === prev) return prev;
      ensureSyncStarted(next);
      return next;
    });
  }, [ensureSyncStarted]);

  const handleUndo = useCallback(() => {
    setState((prev) => {
      if (!prev) return prev;
      return undoMove(prev);
    });
  }, []);

  const startNewGame = useCallback(() => {
    winRecordedRef.current = false;
    prevCompleteRef.current = false;
    const fresh = createGame(TURTLE_LAYOUT);
    setState(fresh);
    setStats((prev) => {
      const updated = { ...prev, gamesPlayed: prev.gamesPlayed + 1 };
      saveStats(updated).catch(() => {});
      return updated;
    });
    if (syncGetGameId()) {
      syncComplete(
        { outcome: "abandoned", finalScore: 0, durationMs: 0 },
        { outcome: "abandoned" }
      );
    }
    syncStart({ layout: "turtle" });
    syncMarkStarted();
  }, [syncGetGameId, syncComplete, syncStart, syncMarkStarted]);

  const undoDisabled = !state || state.undoStack.length === 0 || state.isComplete;

  return (
    <GameShell
      title={t("game.title")}
      requireBack
      loading={loading}
      onBack={() => navigation.popToTop()}
      style={{
        paddingBottom: Math.max(insets.bottom, 16),
        paddingLeft: Math.max(insets.left, 12),
        paddingRight: Math.max(insets.right, 12),
      }}
      onNewGame={startNewGame}
      onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "mahjong" })}
      rightSlot={
        <Pressable
          onPress={handleUndo}
          disabled={undoDisabled}
          style={[
            styles.headerBtn,
            { borderColor: colors.accent, opacity: undoDisabled ? 0.4 : 1 },
          ]}
          accessibilityRole="button"
          accessibilityLabel={t("action.undoLabel")}
          accessibilityState={{ disabled: undoDisabled }}
        >
          <Text style={[styles.headerBtnText, { color: colors.accent }]}>{t("action.undo")}</Text>
        </Pressable>
      }
    >
      {state !== null && (
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.hudRow} accessibilityRole="summary">
            <Text style={[styles.hudText, { color: colors.text }]}>
              {t("hud.score")} {state.score}
            </Text>
            <Text style={[styles.hudText, { color: colors.textMuted }]}>
              {t("hud.pairs")} {state.pairsRemoved}/72
            </Text>
            <Text style={[styles.hudText, { color: colors.textMuted }]}>
              {t("action.shuffle")} {state.shufflesLeft}
            </Text>
            <Text style={[styles.hudText, styles.dealIdText, { color: colors.textMuted }]}>
              {t("hud.deal")} #{state.dealId}
            </Text>
          </View>

          {/* Board container — overflow:hidden clips FlyingPair animations */}
          <View
            style={{
              width: layout.boardWidth,
              height: layout.boardHeight,
              overflow: "hidden",
              alignSelf: "center",
            }}
          >
            <Animated.View style={boardAnimStyle}>
              <GameCanvas
                state={state}
                layout={layout}
                onTilePress={handleTilePress}
                onShufflePress={handleShuffle}
                onNewGamePress={startNewGame}
              />
            </Animated.View>
            {flyingPairs.map((pair) => (
              <FlyingPair
                key={pair.id}
                {...pair}
                layout={layout}
                color={colors.accent + "99"}
                onDone={() => setFlyingPairs((prev) => prev.filter((p) => p.id !== pair.id))}
              />
            ))}
          </View>
        </ScrollView>
      )}

      {state?.isComplete && (
        <WinModal
          score={state.score}
          pairsRemoved={state.pairsRemoved}
          reduceMotion={reduceMotion}
          onNewGame={startNewGame}
        />
      )}
    </GameShell>
  );
}

// ---------------------------------------------------------------------------
// Win modal — name entry + ScoreQueue submission
// ---------------------------------------------------------------------------

function WinModal({
  score,
  pairsRemoved,
  reduceMotion,
  onNewGame,
}: {
  readonly score: number;
  readonly pairsRemoved: number;
  readonly reduceMotion: boolean;
  readonly onNewGame: () => void;
}) {
  const { t } = useTranslation("mahjong");
  const { colors } = useTheme();
  const { isOnline, isInitialized } = useNetwork();

  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Spring entrance on the card (skipped when reduceMotion is on).
  const cardScale = useSharedValue(reduceMotion ? 1 : 0.82);
  useEffect(() => {
    if (!reduceMotion) {
      cardScale.value = withSpring(1, { damping: 14, stiffness: 120 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const cardAnimStyle = useAnimatedStyle(() => ({ transform: [{ scale: cardScale.value }] }));

  const offline = isInitialized && !isOnline;
  const trimmed = name.trim();
  const canSubmit = !submitting && !offline && trimmed.length > 0;

  const gradient: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

  async function handleSubmit() {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await scoreQueue.enqueue("mahjong", { player_name: trimmed, score });
      setSubmitted(true);
      scoreQueue.flush().catch(() => undefined);
    } catch {
      setError(t("error.submitFailed", { defaultValue: "Couldn't save score. Tap to retry." }));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = error
    ? t("error.submitRetry", { defaultValue: "Retry" })
    : t("action.submitScore", { defaultValue: "Submit Score" });

  return (
    <Modal visible transparent animationType="fade" accessibilityViewIsModal>
      <View style={styles.modalOverlay}>
        <Animated.View
          style={[
            styles.modalCard,
            { backgroundColor: colors.surfaceHigh, borderColor: colors.border },
            cardAnimStyle,
          ]}
        >
          <Text style={[styles.modalTitle, { color: colors.text }]} accessibilityRole="header">
            {t("overlay.youWon")}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>
            {t("overlay.youWonDetail", { count: pairsRemoved })}
          </Text>
          <Text style={[styles.modalScore, { color: colors.text }]}>
            {t("score.display", { score })}
          </Text>

          {!submitted ? (
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
                placeholder={t("win.namePlaceholder", { defaultValue: "Your name" })}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                maxLength={MAX_NAME_LENGTH}
                editable={!submitting}
                accessibilityLabel={t("win.nameLabel", { defaultValue: "Enter your name" })}
              />
              {offline ? (
                <OfflineBanner />
              ) : (
                error !== null && (
                  <Text
                    style={[styles.errorText, { color: colors.error }]}
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
              style={[styles.submittedText, { color: colors.bonus }]}
              accessibilityLiveRegion="polite"
            >
              {t("win.submitted", { defaultValue: "Score saved! 🎉" })}
            </Text>
          )}

          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onNewGame}
            accessibilityRole="button"
            accessibilityLabel={t("action.newGameLabel")}
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("action.newGame")}
            </Text>
          </Pressable>
        </Animated.View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create({
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
  scrollContent: {
    flexGrow: 1,
  },
  hudRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  hudText: {
    fontFamily: typography.heading,
    fontSize: 14,
    letterSpacing: 0.5,
  },
  dealIdText: {
    fontSize: 10,
    opacity: 0.6,
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
    fontSize: 22,
    fontWeight: "900",
    letterSpacing: 0.5,
    marginBottom: 6,
    textAlign: "center",
  },
  modalBody: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 4,
    textAlign: "center",
  },
  modalScore: {
    fontSize: 20,
    fontWeight: "700",
    marginBottom: 16,
    fontVariant: ["tabular-nums"],
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
  errorText: {
    fontSize: 13,
    marginBottom: 10,
    textAlign: "center",
  },
  submittedText: {
    fontSize: 18,
    fontWeight: "700",
    marginBottom: 12,
  },
  modalPrimary: {
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 999,
    marginBottom: 10,
    alignItems: "center",
    minWidth: 180,
  },
  modalPrimaryDisabled: {
    opacity: 0.5,
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
});
