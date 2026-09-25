/**
 * SolitaireScreen — playable Klondike with full lifecycle wiring.
 *
 * Composed of three concerns:
 *   1. Selection state machine + tap-to-select / tap-target dispatching
 *      (layered on top of the pure engine from #593 and the card views
 *      from #595; introduced in #596).
 *   2. Persistence — AsyncStorage save/resume on every mutation so a
 *      backgrounded or force-killed app resumes at the exact board.
 *   3. Instrumentation + result — `useGameSync` session (started on the
 *      first real move, completed on win, abandoned on unmount for anything
 *      else), and the shared GameResultModal (#2509) on win, which submits
 *      the score under the player's display name (useLeaderboardSubmit),
 *      queued when offline.
 *
 * Route wiring into HomeStack and the lobby card live in #599; this file
 * is intentionally route-agnostic and reads its navigation via the hook.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Animated, Platform, Pressable, StyleSheet, Text, View, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTranslation } from "react-i18next";
import { useNavigation } from "@react-navigation/native";
import { NativeStackNavigationProp } from "@react-navigation/native-stack";

import type { HomeStackParamList } from "../types/navigation";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { GameShell } from "../components/shared/GameShell";
import { HudStatRow } from "../components/shared/HudStatRow";
import {
  ModalActions,
  ModalCard,
  ModalPrimaryButton,
  ModalSecondaryButton,
} from "../components/shared/ModalCard";
import { PillButton } from "../components/shared/PillButton";
import TableauPile from "../game/solitaire/components/TableauPile";
import FoundationPile from "../game/solitaire/components/FoundationPile";
import StockWastePile from "../game/solitaire/components/StockWastePile";
import { SolitaireWinCascade } from "../game/solitaire/components/SolitaireWinCascade";
import GameResultModal from "../components/shared/GameResultModal";
import { useSound } from "../game/_shared/useSound";
import { SOLITAIRE_SOUNDS } from "../game/solitaire/sounds";
import { CARD_HEIGHT, CARD_WIDTH } from "../game/solitaire/components/CardView";
import {
  applyMove,
  applyHint,
  autoComplete,
  canAutoComplete,
  dealGame,
  drawFromStock,
  getHintMoves,
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
import { areTestHooksEnabled } from "../game/_shared/testHooks";
import {
  clearGame,
  loadGame,
  loadStats,
  saveGame,
  saveStats,
  type SolitaireStats,
} from "../game/solitaire/storage";
import { useSolitaireScoreboard } from "../game/solitaire/SolitaireScoreboardContext";
import { solitaireLeaderboard } from "../game/solitaire/leaderboard";
import { formatMs } from "../game/_shared/formatMs";
import { useGameSync } from "../game/_shared/useGameSync";
import { useLeaderboardSubmit } from "../game/_shared/useLeaderboardSubmit";
import { useCardSelection } from "../game/_shared/useCardSelection";
import { rankLabel } from "../game/_shared/decks/cardId";

const TABLEAU_COLS = 7;
const COL_GAP = 6;
const SCREEN_H_PADDING = 24;
const DOUBLE_TAP_MS = 300;
const AUTO_STEP_MS = 120;

/** The game's play timer so far: time banked plus the running segment. */
function activeMs(state: SolitaireState, now: number = Date.now()): number {
  return state.accumulatedMs + (state.startedAt !== null ? now - state.startedAt : 0);
}

/** What the result card shows for a finished game. */
interface WinSummary {
  readonly timeMs: number;
  readonly moves: number;
  readonly bestTimeMs: number;
  readonly isNewBest: boolean;
}

type Selection =
  | { readonly kind: "waste" }
  | { readonly kind: "tableau"; readonly col: number; readonly index: number }
  | { readonly kind: "foundation"; readonly suit: Suit };

export default function SolitaireScreen() {
  const { t } = useTranslation("solitaire");
  const { t: tResult } = useTranslation("result");
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

  // Lifecycle refs.
  const hasLoadedRef = useRef(false);
  const stateRef = useRef<SolitaireState | null>(null);
  const movesRef = useRef(0);
  const prevCompleteRef = useRef(false);
  /** Guards against double-counting a win within a single game session. */
  const winRecordedRef = useRef(false);

  const [winSummary, setWinSummary] = useState<WinSummary | null>(null);
  /**
   * The loaded save was already won — the app was closed between the win and
   * `clearGame()`. Its score was submitted and its cascade played back then.
   */
  const [resumedWin, setResumedWin] = useState(false);
  const leaderboard = useLeaderboardSubmit(solitaireLeaderboard);
  const { submit: submitScore, reset: resetSubmission } = leaderboard;

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
    resume: syncResume,
    markStarted: syncMarkStarted,
    complete: syncComplete,
    getGameId: syncGetGameId,
    setProgressSnapshot: syncSetProgressSnapshot,
  } = useGameSync("solitaire");

  // #2450 / #2619 — the abandon result block (backend SolitaireResult). Both the
  // hook's own abandon (unmount) and the beforeRemove abandon build it here.
  const progressResult = useCallback(() => ({ won: false, moves: movesRef.current }), []);
  useEffect(() => {
    syncSetProgressSnapshot(() => ({ result: progressResult() }));
  }, [syncSetProgressSnapshot, progressResult]);

  const { setSnapshot: setScoreboardSnapshot } = useSolitaireScoreboard();

  useEffect(() => {
    return () => {
      if (autoStepTimeoutRef.current !== null) clearTimeout(autoStepTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (!state) return;
    const foundationsComplete = Object.values(state.foundations).filter(
      (cards) => cards.length === 13
    ).length;
    const elapsedMs = activeMs(state);
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

  // #597 — mount load. Restores a saved game silently; on a clean slot the
  // pre-game draw-mode modal is shown so the player picks their mode.
  //
  // Native E2E test builds (EXPO_PUBLIC_TEST_HOOKS=1) skip the modal on a
  // clean slot and deal draw-1 immediately — Maestro drives native gestures
  // and has no way to open a locale-dependent modal by text, and every
  // other game's Maestro flow expects to land straight on the board.
  // Web stays on the normal modal path even in a test build: Playwright's
  // web E2E suite also builds with EXPO_PUBLIC_TEST_HOOKS=1 and its specs
  // click through "Draw 1"/"Draw 3" themselves (solitaire-smoke.spec.ts and
  // friends), so skipping the modal there would break them. Production
  // behavior (real users, modal shown) is unchanged either way.
  useEffect(() => {
    let alive = true;
    Promise.all([loadGame(), loadStats()]).then(([saved, savedStats]) => {
      if (!alive) return;
      hasLoadedRef.current = true;
      setStats(savedStats);
      if (saved !== null) {
        setState(saved);
        // Suppress re-counting a win when resuming an already-won game.
        if (saved.isComplete) {
          winRecordedRef.current = true;
          setResumedWin(true);
        } else {
          // A restored game continues the session a killed app left open (#2654).
          syncResume();
        }
      } else if (areTestHooksEnabled() && Platform.OS !== "web") {
        deal(1);
      }
      setLoading(false);
    });
    return () => {
      alive = false;
    };
    // Mount-only by design; `deal` is a stable useCallback ([] deps).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Stats as of the win, read by the completion effect below.
  const statsRef = useRef(stats);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  // #597 — end sync sessions exactly once on the completion transition and
  // clear the saved game so the next mount starts fresh.
  useEffect(() => {
    if (state === null) {
      prevCompleteRef.current = false;
      return;
    }
    if (state.isComplete && !prevCompleteRef.current) {
      syncComplete(
        {
          finalScore: state.score,
          outcome: "completed",
          durationMs: state.accumulatedMs,
          result: { won: true, moves: movesRef.current },
        },
        { final_score: state.score, outcome: "completed", won: true, moves: movesRef.current }
      );
      clearGame().catch(() => {});
      const finalMs = state.accumulatedMs;
      const finalMoves = movesRef.current;
      if (!winRecordedRef.current) {
        winRecordedRef.current = true;
        // Submit only a win that happened this session, so a resumed won
        // game can't post the same score twice.
        submitScore({ score: state.score });
        const isNewBest =
          statsRef.current.bestTimeMs === 0 || finalMs < statsRef.current.bestTimeMs;
        setWinSummary({
          timeMs: finalMs,
          moves: finalMoves,
          bestTimeMs: isNewBest ? finalMs : statsRef.current.bestTimeMs,
          isNewBest,
        });
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
      } else {
        // A resumed, already-won game: its win was counted when it happened.
        setWinSummary({
          timeMs: finalMs,
          moves: finalMoves,
          bestTimeMs: statsRef.current.bestTimeMs,
          isNewBest: false,
        });
      }
    }
    prevCompleteRef.current = state.isComplete;
  }, [state, syncComplete, submitScore]);

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
      const result = progressResult();
      syncComplete(
        {
          outcome: "abandoned",
          finalScore: s?.score ?? 0,
          // The game's own play timer (#2619), not wall-clock time.
          durationMs: s ? activeMs(s) : null,
          result,
        },
        { outcome: "abandoned", ...result }
      );
    });
    return unsub;
  }, [navigation, syncComplete, syncGetGameId, progressResult]);

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
    if (state.events.includes("gameWin")) playGameWin();
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

      if (card.faceUp) {
        setSelection({ kind: "tableau", col, index });
      }
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

  const handleHint = useCallback(() => {
    if (state === null || state.isComplete || autoCompleting) return;
    setState(applyHint(state));
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

  /** Tears down the current game (board, timers, result) and shows the draw-mode picker. */
  const resetToPreGame = useCallback(() => {
    if (autoStepTimeoutRef.current !== null) {
      clearTimeout(autoStepTimeoutRef.current);
      autoStepTimeoutRef.current = null;
    }
    clearGame().catch(() => {});
    setAutoCompleting(false);
    setState(null);
    setSelection(null);
    setMoves(0);
    setWinSummary(null);
    resetSubmission();
    winRecordedRef.current = false;
    setResumedWin(false);
  }, [resetSubmission]);

  // Play Again deals straight into the same draw mode, skipping the picker.
  const handlePlayAgain = useCallback(() => {
    const drawMode = stateRef.current?.drawMode ?? 1;
    resetToPreGame();
    deal(drawMode);
  }, [resetToPreGame, deal]);

  const undoDisabled = state === null || state.undoStack.length === 0 || autoCompleting;
  const hintMoves = useMemo(() => (state ? getHintMoves(state) : []), [state]);
  const hintDisabled =
    state === null || state.isComplete || autoCompleting || hintMoves.length === 0;
  const showAutoComplete = useMemo(
    () => state !== null && !state.isComplete && canAutoComplete(state),
    [state]
  );
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

  const hint = state?.hint;
  const hintSourceCol = useMemo((): number | undefined => {
    if (!hint) return undefined;
    if (hint.type === "tableau-to-tableau" || hint.type === "tableau-to-foundation") {
      return hint.fromCol;
    }
    return undefined;
  }, [hint]);

  const hintSourceCardIndex = useMemo((): number | undefined => {
    if (!hint || !state) return undefined;
    if (hint.type === "tableau-to-tableau") {
      return hint.fromIndex;
    }
    if (hint.type === "tableau-to-foundation") {
      const col = state.tableau[hint.fromCol];
      return col ? col.length - 1 : undefined;
    }
    return undefined;
  }, [hint, state]);

  const hintDestTableauCol = useMemo((): number | undefined => {
    if (!hint) return undefined;
    if (
      hint.type === "tableau-to-tableau" ||
      hint.type === "waste-to-tableau" ||
      hint.type === "foundation-to-tableau"
    ) {
      return hint.toCol;
    }
    return undefined;
  }, [hint]);

  const hintDestSuit = useMemo((): string | undefined => {
    if (!hint || !state) return undefined;
    if (hint.type === "waste-to-foundation") {
      const card = state.waste[state.waste.length - 1];
      return card?.suit;
    }
    if (hint.type === "tableau-to-foundation") {
      const col = state.tableau[hint.fromCol];
      const card = col?.[col.length - 1];
      return card?.suit;
    }
    return undefined;
  }, [hint, state]);

  const hintSourceFoundationSuit = useMemo((): string | undefined => {
    if (!hint) return undefined;
    if (hint.type === "foundation-to-tableau") return hint.fromSuit;
    return undefined;
  }, [hint]);

  const hintSourceIsWaste = useMemo((): boolean => {
    if (!hint) return false;
    return hint.type === "waste-to-tableau" || hint.type === "waste-to-foundation";
  }, [hint]);

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
          <View style={styles.headerBtnRow}>
            <PillButton
              testID="solitaire-hint-button"
              label={t("solitaire:action.hint")}
              onPress={handleHint}
              disabled={hintDisabled}
              color={colors.bonus}
            />
            <PillButton
              label={t("solitaire:action.undo")}
              onPress={handleUndo}
              disabled={undoDisabled}
            />
          </View>
        }
      >
        {state === null ? (
          <PreGameModal onChoose={deal} />
        ) : (
          <CardSizeContext.Provider value={cardSize}>
            <DragContainer style={styles.body as ViewStyle}>
              <HudStatRow
                size="lg"
                stats={[
                  { key: "score", text: t("solitaire:score.label", { score: state.score }) },
                  { key: "moves", text: t("solitaire:score.moves", { moves }), muted: true },
                ]}
              />

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
                    hintSource={hintSourceIsWaste}
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
                          hintDestination={hintDestSuit === suit}
                          hintSource={hintSourceFoundationSuit === suit}
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
                      hintIndex={hintSourceCol === col ? hintSourceCardIndex : undefined}
                      hintDestination={hintDestTableauCol === col}
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

        {state !== null ? (
          <GameResultModal
            visible={state.isComplete}
            outcome="win"
            eyebrow={`${t("game.title")} · ${t(state.drawMode === 1 ? "drawMode.one" : "drawMode.three")}`}
            hero={{ kind: "score", label: tResult("stat.score"), value: state.score }}
            isNewBest={winSummary?.isNewBest ?? false}
            stats={[
              {
                label: tResult("stat.time"),
                value: formatMs(winSummary?.timeMs ?? state.accumulatedMs),
              },
              { label: tResult("stat.moves"), value: winSummary?.moves ?? moves },
              ...(winSummary && winSummary.bestTimeMs > 0
                ? [{ label: tResult("stat.best"), value: formatMs(winSummary.bestTimeMs) }]
                : []),
            ]}
            submission={{
              status: leaderboard.status,
              rank: leaderboard.rank,
              playerName: leaderboard.playerName,
              onProvideName: leaderboard.provideName,
              onRetry: leaderboard.retry,
            }}
            onPlayAgain={handlePlayAgain}
            secondaryAction={{ label: tResult("action.changeMode"), onPress: resetToPreGame }}
            onHome={() => navigation.popToTop()}
            // Only a win that just happened plays the cascade; a resumed,
            // already-won game goes straight to the card.
            celebration={
              !resumedWin && state.events?.includes("gameWin")
                ? (done) => <SolitaireWinCascade onDone={done} />
                : undefined
            }
            testID="solitaire-result"
          />
        ) : null}
      </GameShell>
    </DragProvider>
  );
}

// ---------------------------------------------------------------------------
// Pre-game draw-mode modal
// ---------------------------------------------------------------------------

function PreGameModal({ onChoose }: { readonly onChoose: (mode: DrawMode) => void }) {
  const { t } = useTranslation("solitaire");

  return (
    <ModalCard visible title={t("drawMode.title")} body={t("drawMode.body")}>
      <ModalActions>
        <ModalPrimaryButton label={t("drawMode.one")} onPress={() => onChoose(1)} />
        <ModalSecondaryButton
          tone="accent"
          label={t("drawMode.three")}
          onPress={() => onChoose(3)}
        />
      </ModalActions>
    </ModalCard>
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
    gap: 8,
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
});
