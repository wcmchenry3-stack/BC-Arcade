/**
 * SolitaireScreen — playable Klondike with full lifecycle wiring.
 *
 * Composed of three concerns:
 *   1. Selection state machine + tap-to-select / tap-target dispatching
 *      (layered on top of the pure engine from #593 and the card views
 *      from #595; introduced in #596).
 *   2. Persistence — AsyncStorage save/resume on every mutation so a
 *      backgrounded or force-killed app resumes at the exact board.
 *   3. Instrumentation + leaderboard — `useGameSync` session (started on
 *      the first real move, completed on win, abandoned on unmount for
 *      anything else) and `POST /solitaire/score` on win with an in-modal
 *      retry affordance.
 *
 * Route wiring into HomeStack and the lobby card live in #599; this file
 * is intentionally route-agnostic and reads its navigation via the hook.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Animated,
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
import TableauPile from "../game/solitaire/components/TableauPile";
import FoundationPile from "../game/solitaire/components/FoundationPile";
import StockWastePile from "../game/solitaire/components/StockWastePile";
import { SolitaireWinCascade } from "../game/solitaire/components/SolitaireWinCascade";
import { useSound } from "../game/_shared/useSound";
import { SOLITAIRE_SOUNDS } from "../game/solitaire/sounds";
import { CARD_HEIGHT, CARD_WIDTH } from "../game/solitaire/components/CardView";
import {
  applyMove,
  autoComplete,
  canAutoComplete,
  dealGame,
  drawFromStock,
  recycleWaste,
  undo,
  validateMove,
} from "../game/solitaire/engine";
import type { DrawMode, Move, SolitaireState, Suit } from "../game/solitaire/types";
import { SUITS } from "../game/solitaire/types";
import { DragProvider } from "../game/_shared/drag/DragContext";
import { DragContainer } from "../game/_shared/drag/DragContainer";
import type { DragSource, DragCard } from "../game/_shared/drag/DragContext";
import { CardSizeContext, useResponsiveCardSize } from "../game/_shared/CardSizeContext";
import {
  clearGame,
  loadGame,
  loadStats,
  saveGame,
  saveStats,
  type SolitaireStats,
} from "../game/solitaire/storage";
import { useSolitaireScoreboard } from "../game/solitaire/SolitaireScoreboardContext";
import { solitaireApi, type ScoreEntry } from "../game/solitaire/api";
import { useGameSync } from "../game/_shared/useGameSync";
import { useNetwork } from "../game/_shared/NetworkContext";
import { OfflineBanner } from "../components/shared/OfflineBanner";
import { useCardSelection } from "../game/_shared/useCardSelection";
import { rankLabel } from "../game/_shared/decks/cardId";

const TABLEAU_COLS = 7;
const COL_GAP = 6;
const SCREEN_H_PADDING = 24;
const DOUBLE_TAP_MS = 300;
const AUTO_STEP_MS = 120;
const MAX_NAME_LENGTH = 32;

type Selection =
  | { readonly kind: "waste" }
  | { readonly kind: "tableau"; readonly col: number; readonly index: number }
  | { readonly kind: "foundation"; readonly suit: Suit };

export default function SolitaireScreen() {
  const { t } = useTranslation("solitaire");
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();

  const [state, setState] = useState<SolitaireState | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [moves, setMoves] = useState(0);
  const [autoCompleting, setAutoCompleting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<SolitaireStats>({
    bestTimeMs: 0,
    bestMoves: 0,
    gamesPlayed: 0,
    gamesWon: 0,
  });

  const sparkleOpacity = useRef(new Animated.Value(0)).current;
  const lastTapRef = useRef<{ key: string; time: number } | null>(null);
  const autoStepTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const winCascadeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Lifecycle refs.
  const hasLoadedRef = useRef(false);
  const stateRef = useRef<SolitaireState | null>(null);
  const movesRef = useRef(0);
  const prevCompleteRef = useRef(false);
  /** Guards against double-counting a win within a single game session. */
  const winRecordedRef = useRef(false);

  const [cascadeVisible, setCascadeVisible] = useState(false);

  const { play: playCardFlip } = useSound("solitaire.cardFlip", SOLITAIRE_SOUNDS);
  const { play: playCardPlace } = useSound("solitaire.cardPlace", SOLITAIRE_SOUNDS);
  const { play: playFoundationComplete } = useSound(
    "solitaire.foundationComplete",
    SOLITAIRE_SOUNDS
  );
  const { play: playInvalidMove } = useSound("solitaire.invalidMove", SOLITAIRE_SOUNDS);
  const { play: playGameWin } = useSound("solitaire.gameWin", SOLITAIRE_SOUNDS);
  const { shakeX, triggerIllegal } = useCardSelection(playInvalidMove);

  const {
    start: syncStart,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
  } = useGameSync("solitaire");

  const { setSnapshot: setScoreboardSnapshot } = useSolitaireScoreboard();

  useEffect(() => {
    return () => {
      if (autoStepTimeoutRef.current !== null) clearTimeout(autoStepTimeoutRef.current);
      if (winCascadeTimeoutRef.current !== null) clearTimeout(winCascadeTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const foundationsComplete = Object.values(state.foundations).filter(
      (cards) => cards.length === 13
    ).length;
    const elapsedMs =
      state.accumulatedMs + (state.startedAt !== null ? Date.now() - state.startedAt : 0);
    setScoreboardSnapshot({
      moves,
      elapsedMs,
      foundationsComplete,
      hasGame: true,
      bestTimeMs: stats.bestTimeMs,
      bestMoves: stats.bestMoves,
      gamesPlayed: stats.gamesPlayed,
      gamesWon: stats.gamesWon,
    });
  }, [state, moves, stats, setScoreboardSnapshot]);

  // #597 — mount load. Restores a saved game silently; on a clean slot the
  // pre-game draw-mode modal is shown so the player picks their mode.
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats()]).then(([saved, savedStats]) => {
      if (!alive) return;
      hasLoadedRef.current = true;
      if (saved !== null) {
        setState(saved);
        // Suppress re-counting a win when resuming an already-won game.
        if (saved.isComplete) winRecordedRef.current = true;
      }
      setStats(savedStats);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, []);

  // #597 — persist on every state change once the mount load has resolved.
  // Saves before the load are suppressed so a fresh deal cannot clobber a
  // resumable save still being read from disk.
  useEffect(() => {
    stateRef.current = state;
    if (!hasLoadedRef.current) return;
    if (state === null) return;
    saveGame(state).catch(() => {});
  }, [state]);

  // #597 — mirror moves into a ref so the navigation listener can read the
  // latest value without re-subscribing every tick.
  useEffect(() => {
    movesRef.current = moves;
  }, [moves]);

  // #597 — end sync sessions exactly once on the completion transition and
  // clear the saved game so the next mount starts fresh.
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      syncComplete(
        { finalScore: state.score, outcome: "completed", durationMs: state.accumulatedMs },
        { final_score: state.score, outcome: "completed", moves: movesRef.current }
      );
      clearGame().catch(() => {});
      if (!winRecordedRef.current) {
        winRecordedRef.current = true;
        const finalMs = state.accumulatedMs;
        const finalMoves = movesRef.current;
        setStats((prev) => {
          const updated: SolitaireStats = {
            ...prev,
            gamesWon: prev.gamesWon + 1,
            bestTimeMs:
              prev.bestTimeMs === 0 || finalMs < prev.bestTimeMs ? finalMs : prev.bestTimeMs,
            bestMoves:
              prev.bestMoves === 0 || finalMoves < prev.bestMoves ? finalMoves : prev.bestMoves,
          };
          saveStats(updated);
          return updated;
        });
      }
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete]);

  // #597 — abandon on back-navigation when a move has been made and the
  // game isn't already complete. `useGameSync`'s unmount handler provides a
  // second line of defense; calling complete here first is idempotent
  // (it flips `completedRef` so the unmount handler becomes a no-op).
  useEffect(() => {
    const unsub = navigation.addListener("beforeRemove", () => {
      const s = stateRef.current;
      if (!syncGetGameId()) return;
      if (s !== null && s.isComplete) return;
      if (movesRef.current < 1) return;
      syncComplete(
        { outcome: "abandoned", finalScore: s?.score ?? 0, durationMs: 0 },
        { outcome: "abandoned", moves: movesRef.current }
      );
    });
    return unsub;
  }, [navigation, syncComplete, syncGetGameId]);

  useEffect(() => {
    if (!state?.events) return;
    if (state.events.includes("cardPlace")) playCardPlace();
    if (state.events.includes("cardFlip")) playCardFlip();
    if (state.events.includes("foundationComplete")) {
      playFoundationComplete();
      Animated.sequence([
        Animated.timing(sparkleOpacity, { toValue: 1, duration: 100, useNativeDriver: true }),
        Animated.timing(sparkleOpacity, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]).start();
    }
    if (state.events.includes("gameWin")) {
      playGameWin();
      setCascadeVisible(true);
      if (winCascadeTimeoutRef.current !== null) clearTimeout(winCascadeTimeoutRef.current);
      winCascadeTimeoutRef.current = setTimeout(() => setCascadeVisible(false), 2000);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.events]);

  const ensureSyncStarted = useCallback(
    (s: SolitaireState) => {
      if (syncGetGameId()) return;
      syncStart({ draw_mode: s.drawMode });
      syncMarkStarted();
    },
    [syncGetGameId, syncStart, syncMarkStarted]
  );

  const deal = useCallback((drawMode: DrawMode) => {
    setState(dealGame(drawMode));
    setSelection(null);
    setMoves(0);
    setStats((prev) => {
      const updated = { ...prev, gamesPlayed: prev.gamesPlayed + 1 };
      saveStats(updated);
      return updated;
    });
  }, []);

  const tryMove = useCallback(
    (move: Move): boolean => {
      if (state === null) return false;
      const next = applyMove(state, move);
      if (next.events?.includes("invalidMove")) return false;
      ensureSyncStarted(next);
      setState(next);
      setMoves((m) => m + 1);
      setSelection(null);
      return true;
    },
    [state, ensureSyncStarted]
  );

  const handleWastePress = useCallback(() => {
    if (state === null || autoCompleting) return;
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = last !== null && last.key === "waste" && now - last.time < DOUBLE_TAP_MS;
    lastTapRef.current = { key: "waste", time: now };

    if (isDouble) {
      if (!tryMove({ type: "waste-to-foundation" })) triggerIllegal();
      return;
    }
    if (state.waste.length === 0) return;
    if (selection?.kind === "waste") {
      setSelection(null);
      return;
    }
    setSelection({ kind: "waste" });
  }, [state, selection, autoCompleting, tryMove, triggerIllegal]);

  const handleStockPress = useCallback(() => {
    if (state === null || autoCompleting) return;
    lastTapRef.current = null;
    const next = state.stock.length > 0 ? drawFromStock(state) : recycleWaste(state);
    if (next === state) return;
    ensureSyncStarted(next);
    setState(next);
    setMoves((m) => m + 1);
    setSelection(null);
  }, [state, autoCompleting, ensureSyncStarted]);

  const handleFoundationPress = useCallback(
    (suit: Suit) => {
      if (state === null || autoCompleting) return;
      lastTapRef.current = null;

      if (selection !== null) {
        if (selection.kind === "waste") {
          if (tryMove({ type: "waste-to-foundation" })) return;
          triggerIllegal();
          return;
        }
        if (selection.kind === "tableau") {
          const col = state.tableau[selection.col];
          if (col !== undefined && selection.index === col.length - 1) {
            if (tryMove({ type: "tableau-to-foundation", fromCol: selection.col })) return;
          }
          triggerIllegal();
          return;
        }
        if (selection.kind === "foundation") {
          if (selection.suit === suit) setSelection(null);
          else triggerIllegal();
          return;
        }
      }
      if (state.foundations[suit].length > 0) {
        setSelection({ kind: "foundation", suit });
      }
    },
    [state, selection, autoCompleting, tryMove, triggerIllegal]
  );

  const handleTableauCardPress = useCallback(
    (col: number, index: number) => {
      if (state === null || autoCompleting) return;
      const pile = state.tableau[col];
      if (pile === undefined) return;
      const card = pile[index];
      if (card === undefined) return;

      const key = `tableau:${col}:${index}`;
      const now = Date.now();
      const last = lastTapRef.current;
      const isDouble = last !== null && last.key === key && now - last.time < DOUBLE_TAP_MS;
      lastTapRef.current = { key, time: now };

      if (isDouble && index === pile.length - 1 && card.faceUp) {
        if (!tryMove({ type: "tableau-to-foundation", fromCol: col })) triggerIllegal();
        return;
      }

      if (selection !== null) {
        // Face-down card with active selection → no-op (no flash, no deselect).
        if (!card.faceUp) return;

        if (selection.kind === "waste") {
          if (tryMove({ type: "waste-to-tableau", toCol: col })) return;
          triggerIllegal();
          return;
        }
        if (selection.kind === "foundation") {
          if (tryMove({ type: "foundation-to-tableau", fromSuit: selection.suit, toCol: col }))
            return;
          triggerIllegal();
          return;
        }
        if (selection.kind === "tableau") {
          if (selection.col === col) {
            if (selection.index === index) {
              setSelection(null);
              return;
            }
            // Face-up guaranteed by the guard above — re-select within same column.
            setSelection({ kind: "tableau", col, index });
            return;
          }
          // Different column, face-up guaranteed. Legal destination → move; otherwise re-select.
          const move = {
            type: "tableau-to-tableau" as const,
            fromCol: selection.col,
            fromIndex: selection.index,
            toCol: col,
          };
          if (validateMove(state, move)) {
            tryMove(move);
          } else {
            setSelection({ kind: "tableau", col, index });
          }
          return;
        }
      }

      if (card.faceUp) setSelection({ kind: "tableau", col, index });
    },
    [state, selection, autoCompleting, tryMove, triggerIllegal]
  );

  const handleEmptyTableauPress = useCallback(
    (col: number) => {
      if (state === null || autoCompleting) return;
      lastTapRef.current = null;
      if (selection === null) return;
      if (selection.kind === "waste") {
        if (!tryMove({ type: "waste-to-tableau", toCol: col })) triggerIllegal();
        return;
      }
      if (selection.kind === "foundation") {
        if (!tryMove({ type: "foundation-to-tableau", fromSuit: selection.suit, toCol: col }))
          triggerIllegal();
        return;
      }
      if (selection.kind === "tableau") {
        if (
          !tryMove({
            type: "tableau-to-tableau",
            fromCol: selection.col,
            fromIndex: selection.index,
            toCol: col,
          })
        )
          triggerIllegal();
      }
    },
    [state, selection, autoCompleting, tryMove, triggerIllegal]
  );

  // ── Drag-and-drop handlers ─────────────────────────────────────────────────

  const handleDropToTableau = useCallback(
    (source: DragSource, toCol: number): boolean => {
      if (source.game !== "solitaire") return false;
      if (source.type === "tableau") {
        return tryMove({
          type: "tableau-to-tableau",
          fromCol: source.col,
          fromIndex: source.fromIndex,
          toCol,
        });
      }
      if (source.type === "waste") return tryMove({ type: "waste-to-tableau", toCol });
      if (source.type === "foundation") {
        return tryMove({ type: "foundation-to-tableau", fromSuit: source.suit as Suit, toCol });
      }
      return false;
    },
    [tryMove]
  );

  const handleDropToFoundation = useCallback(
    (source: DragSource): boolean => {
      if (source.game !== "solitaire") return false;
      if (source.type === "tableau")
        return tryMove({ type: "tableau-to-foundation", fromCol: source.col });
      if (source.type === "waste") return tryMove({ type: "waste-to-foundation" });
      return false;
    },
    [tryMove]
  );

  const getLegalDropIds = useCallback(
    (source: DragSource, cards: DragCard[]): string[] => {
      if (state === null || source.game !== "solitaire") return [];
      const ids: string[] = [];

      for (let col = 0; col < TABLEAU_COLS; col++) {
        let move: Move | null = null;
        if (source.type === "tableau" && source.col !== col) {
          move = {
            type: "tableau-to-tableau",
            fromCol: source.col,
            fromIndex: source.fromIndex,
            toCol: col,
          };
        } else if (source.type === "waste") {
          move = { type: "waste-to-tableau", toCol: col };
        } else if (source.type === "foundation") {
          move = { type: "foundation-to-tableau", fromSuit: source.suit as Suit, toCol: col };
        }
        if (move && validateMove(state, move)) ids.push(`solitaire-tableau-${col}`);
      }

      if (cards.length === 1) {
        let foundMove: Move | null = null;
        if (source.type === "tableau")
          foundMove = { type: "tableau-to-foundation", fromCol: source.col };
        else if (source.type === "waste") foundMove = { type: "waste-to-foundation" };
        if (foundMove && validateMove(state, foundMove)) {
          for (const suit of SUITS) ids.push(`solitaire-foundation-${suit}`);
        }
      }

      return ids;
    },
    [state]
  );

  // ── Undo / auto-complete ────────────────────────────────────────────────────

  const handleUndo = useCallback(() => {
    if (state === null || autoCompleting) return;
    if (state.undoStack.length === 0) return;
    setState(undo(state));
    setSelection(null);
    setMoves((m) => Math.max(0, m - 1));
  }, [state, autoCompleting]);

  const handleAutoComplete = useCallback(() => {
    if (state === null || autoCompleting) return;
    setAutoCompleting(true);
    setSelection(null);
    let current = state;
    const step = () => {
      const next = autoComplete(current);
      if (next === current) {
        setAutoCompleting(false);
        return;
      }
      ensureSyncStarted(next);
      current = next;
      setState(next);
      setMoves((m) => m + 1);
      if (next.isComplete) {
        setAutoCompleting(false);
        return;
      }
      autoStepTimeoutRef.current = setTimeout(step, AUTO_STEP_MS);
    };
    step();
  }, [state, autoCompleting, ensureSyncStarted]);

  const resetToPreGame = useCallback(() => {
    if (autoStepTimeoutRef.current !== null) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }
    if (winCascadeTimeoutRef.current !== null) {
      clearTimeout(winCascadeTimeoutRef.current);
      winCascadeTimeoutRef.current = null;
    }
    clearGame().catch(() => {});
    setAutoCompleting(false);
    setState(null);
    setSelection(null);
    setMoves(0);
    setCascadeVisible(false);
    winRecordedRef.current = false;
  }, []);

  const undoDisabled = state === null || state.undoStack.length === 0 || autoCompleting;
  const showAutoComplete = state !== null && !state.isComplete && canAutoComplete(state);
  const cardSize = useResponsiveCardSize(
    CARD_WIDTH,
    CARD_HEIGHT,
    TABLEAU_COLS,
    COL_GAP,
    SCREEN_H_PADDING
  );
  const boardWidth = TABLEAU_COLS * cardSize.cardWidth + (TABLEAU_COLS - 1) * COL_GAP;

  const tableauSelection = (col: number): number | undefined => {
    if (selection === null || selection.kind !== "tableau") return undefined;
    if (selection.col !== col) return undefined;
    return selection.index;
  };

  const selectionLabel = useMemo((): string | null => {
    if (!selection || !state) return null;
    if (selection.kind === "waste") {
      const card = state.waste[state.waste.length - 1];
      if (!card?.faceUp) return null;
      return t("card.faceUpSelected", {
        rank: rankLabel(card.rank),
        suit: t(`suit.${card.suit}` as const),
      });
    }
    if (selection.kind === "foundation") {
      const pile = state.foundations[selection.suit];
      const card = pile[pile.length - 1];
      if (!card) return null;
      return t("card.faceUpSelected", {
        rank: rankLabel(card.rank),
        suit: t(`suit.${card.suit}` as const),
      });
    }
    // tableau
    const col = state.tableau[selection.col];
    const card = col?.[selection.index];
    if (!card) return null;
    if (!card.faceUp) return t("card.faceDownSelected");
    return t("card.faceUpSelected", {
      rank: rankLabel(card.rank),
      suit: t(`suit.${card.suit}` as const),
    });
  }, [selection, state, t]);

  return (
    <DragProvider getLegalDropIds={getLegalDropIds}>
      <GameShell
        title={t("solitaire:game.title")}
        requireBack
        loading={loading}
        onBack={() => navigation.popToTop()}
        style={{
          paddingBottom: Math.max(insets.bottom, 16),
          paddingLeft: Math.max(insets.left, 12),
          paddingRight: Math.max(insets.right, 12),
        }}
        onNewGame={resetToPreGame}
        onOpenScoreboard={() => navigation.navigate("Scoreboard", { gameKey: "solitaire" })}
        rightSlot={
          <Pressable
            onPress={handleUndo}
            disabled={undoDisabled}
            style={[
              styles.headerBtn,
              { borderColor: colors.accent, opacity: undoDisabled ? 0.4 : 1 },
            ]}
            accessibilityRole="button"
            accessibilityLabel={t("solitaire:action.undo")}
            accessibilityState={{ disabled: undoDisabled }}
          >
            <Text style={[styles.headerBtnText, { color: colors.accent }]}>
              {t("solitaire:action.undo")}
            </Text>
          </Pressable>
        }
      >
        {state === null ? (
          <PreGameModal onChoose={deal} />
        ) : (
          <CardSizeContext.Provider value={cardSize}>
            <DragContainer style={styles.body as ViewStyle}>
              <View style={styles.hudRow} accessibilityRole="summary">
                <Text
                  style={[styles.hudText, { color: colors.text }]}
                  accessibilityLabel={t("solitaire:score.label", { score: state.score })}
                >
                  {t("solitaire:score.label", { score: state.score })}
                </Text>
                <Text
                  style={[styles.hudText, { color: colors.textMuted }]}
                  accessibilityLabel={t("solitaire:score.moves", { moves })}
                >
                  {t("solitaire:score.moves", { moves })}
                </Text>
              </View>

              <View
                style={[styles.board, { width: boardWidth }]}
                accessibilityLabel={t("solitaire:a11y.boardRegion")}
              >
                <View style={styles.topRow}>
                  <StockWastePile
                    stock={state.stock}
                    waste={state.waste}
                    drawMode={state.drawMode}
                    wasteSelected={selection?.kind === "waste"}
                    shakeX={selection?.kind === "waste" ? shakeX : undefined}
                    onStockPress={handleStockPress}
                    onWastePress={handleWastePress}
                  />
                  <View style={{ flex: 1 }} />
                  <View>
                    <View style={styles.foundationsRow}>
                      {SUITS.map((suit) => (
                        <FoundationPile
                          key={suit}
                          pile={state.foundations[suit]}
                          suit={suit}
                          selected={selection?.kind === "foundation" && selection.suit === suit}
                          shakeX={
                            selection?.kind === "foundation" && selection.suit === suit
                              ? shakeX
                              : undefined
                          }
                          onPress={handleFoundationPress}
                          dropId={`solitaire-foundation-${suit}`}
                          onDrop={(source) => handleDropToFoundation(source)}
                        />
                      ))}
                    </View>
                    <Animated.View
                      pointerEvents="none"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                      style={[
                        StyleSheet.absoluteFill,
                        { backgroundColor: "#ffd700", opacity: sparkleOpacity, borderRadius: 8 },
                      ]}
                    />
                  </View>
                </View>

                <View style={[styles.tableauRow, { minHeight: cardSize.cardHeight * 3 }]}>
                  {state.tableau.map((pile, col) => (
                    <TableauPile
                      key={col}
                      pile={pile}
                      colIndex={col}
                      selectedIndex={tableauSelection(col)}
                      shakeX={
                        selection?.kind === "tableau" && selection.col === col ? shakeX : undefined
                      }
                      onCardPress={handleTableauCardPress}
                      onEmptyPress={handleEmptyTableauPress}
                      dropId={`solitaire-tableau-${col}`}
                      onDrop={(source) => handleDropToTableau(source, col)}
                    />
                  ))}
                </View>
              </View>

              {showAutoComplete && (
                <Pressable
                  onPress={handleAutoComplete}
                  style={[styles.autoBtn, { backgroundColor: colors.accent }]}
                  accessibilityRole="button"
                  accessibilityLabel={t("solitaire:action.autoComplete")}
                >
                  <Text style={[styles.autoBtnText, { color: colors.textOnAccent }]}>
                    {t("solitaire:action.autoComplete")}
                  </Text>
                </Pressable>
              )}

              <SolitaireWinCascade visible={cascadeVisible} />

              <View
                style={[styles.selectionIndicator, { bottom: Math.max(insets.bottom, 8) }]}
                accessibilityLiveRegion="polite"
                pointerEvents="none"
              >
                {selectionLabel !== null && (
                  <Text style={[styles.selectionIndicatorText, { color: colors.accent }]}>
                    {selectionLabel}
                  </Text>
                )}
              </View>
            </DragContainer>
          </CardSizeContext.Provider>
        )}

        {state?.isComplete === true && <WinModal score={state.score} onNewGame={resetToPreGame} />}
      </GameShell>
    </DragProvider>
  );
}

// ---------------------------------------------------------------------------
// Pre-game draw-mode modal
// ---------------------------------------------------------------------------

function PreGameModal({ onChoose }: { readonly onChoose: (mode: DrawMode) => void }) {
  const { t } = useTranslation("solitaire");
  const { colors } = useTheme();

  const gradient: ViewStyle =
    Platform.OS === "web"
      ? ({
          backgroundImage: `linear-gradient(135deg, ${colors.accent}, ${colors.accentBright})`,
        } as ViewStyle)
      : { backgroundColor: colors.accentBright };

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
            {t("drawMode.title")}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>{t("drawMode.body")}</Text>
          <Pressable
            style={[styles.modalPrimary, gradient]}
            onPress={() => onChoose(1)}
            accessibilityRole="button"
            accessibilityLabel={t("drawMode.one")}
          >
            <Text style={[styles.modalPrimaryText, { color: colors.textOnAccent }]}>
              {t("drawMode.one")}
            </Text>
          </Pressable>
          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={() => onChoose(3)}
            accessibilityRole="button"
            accessibilityLabel={t("drawMode.three")}
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("drawMode.three")}
            </Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Win modal — name entry + score POST with retry
// ---------------------------------------------------------------------------

function WinModal({
  score,
  onNewGame,
}: {
  readonly score: number;
  readonly onNewGame: () => void;
}) {
  const { t } = useTranslation("solitaire");
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
      const entry = await solitaireApi.submitScore(trimmed, score);
      setSubmitted(entry);
    } catch {
      setError(t("solitaire:error.submitFailed"));
    } finally {
      setSubmitting(false);
    }
  }

  const submitLabel = error ? t("solitaire:error.submitRetry") : t("solitaire:action.submitScore");

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
            {t("solitaire:win.title")}
          </Text>
          <Text style={[styles.modalBody, { color: colors.textMuted }]}>
            {t("solitaire:win.score", { score })}
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
                placeholder={t("solitaire:win.namePlaceholder")}
                placeholderTextColor={colors.textMuted}
                value={name}
                onChangeText={setName}
                maxLength={MAX_NAME_LENGTH}
                editable={!submitting}
                accessibilityLabel={t("solitaire:win.nameLabel")}
                accessibilityHint={t("solitaire:win.nameHint")}
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
                testID="submit-score-button"
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
              {t("solitaire:win.rank", { rank: submitted.rank })}
            </Text>
          )}

          <Pressable
            style={[styles.modalSecondary, { borderColor: colors.accent }]}
            onPress={onNewGame}
            accessibilityRole="button"
            accessibilityLabel={t("solitaire:action.newGame")}
            testID="new-game-button"
          >
            <Text style={[styles.modalSecondaryText, { color: colors.accent }]}>
              {t("solitaire:action.newGame")}
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
  hudRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 4,
    paddingVertical: 8,
  },
  hudText: {
    fontFamily: typography.heading,
    fontSize: 16,
    letterSpacing: 0.5,
  },
  board: {
    alignSelf: "flex-start",
  },
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    marginBottom: 12,
  },
  foundationsRow: {
    flexDirection: "row",
    gap: COL_GAP,
  },
  selectionIndicator: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
    paddingVertical: 8,
  },
  selectionIndicatorText: {
    fontFamily: typography.heading,
    fontSize: 13,
    fontWeight: "700",
    letterSpacing: 0.4,
  },
  tableauRow: {
    flexDirection: "row",
    gap: COL_GAP,
    alignItems: "flex-start",
  },
  autoBtn: {
    alignSelf: "center",
    paddingHorizontal: 24,
    paddingVertical: 10,
    borderRadius: 999,
    marginTop: 12,
  },
  autoBtnText: {
    fontSize: 13,
    fontWeight: "800",
    letterSpacing: 1,
    textTransform: "uppercase",
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
  nameInput: {
    width: "100%",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 1,
    fontSize: 15,
    marginBottom: 12,
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
