import React, { useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, View } from "react-native";
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from "react-native";
import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";

import { SUITS } from "../../game/freecell/types";
import { validateMove } from "../../game/freecell/engine";
import type { FreeCellState, Move, Suit } from "../../game/freecell/types";
import { legalTargets, type FreeCellSelection } from "../../game/freecell/targets";
import {
  FREECELL_COLUMNS,
  SCROLL_BAR_HEIGHT,
  SCROLL_PAD,
  freeCellBoardWidth,
  freeCellGeometry,
} from "../../game/freecell/layout";
import { faceUpStepFor, type TableGeometry } from "../../game/_shared/cards/tableLayout";
import FreeCellSlot from "./FreeCellSlot";
import FoundationPile from "./FoundationPile";
import TableauColumn from "./TableauColumn";
import { CardSizeContext, useCardSize } from "../../game/_shared/CardSizeContext";
import { DragProvider } from "../../game/_shared/drag/DragContext";
import { DragContainer } from "../../game/_shared/drag/DragContainer";
import type { DragSource, DragCard, DropOffset } from "../../game/_shared/drag/DragContext";
import { CardFlightContext, CardFlightLayer } from "../cards/cardFlights";
import type { DragDiagnosticTags } from "../../game/_shared/drag/dragDiagnostics";
import { useSound } from "../../game/_shared/useSound";
import { FREECELL_SOUNDS } from "../../game/freecell/sounds";
import { useCardSelection } from "../../game/_shared/useCardSelection";

const TABLEAU_COLS = FREECELL_COLUMNS;
const DOUBLE_TAP_MS = 300;
/** The buttons are 44 dp tall, the platform minimum touch target. */
const SCROLL_BUTTON_HEIGHT = 44;
const SCROLL_BUTTON_WIDTH = 56;
const SCROLL_BUTTON_HIT_SLOP = { top: 4, bottom: 4, left: 4, right: 4 } as const;
const SCROLL_EVENT_THROTTLE_MS = 50;
/** Height of the felt the board assumes when the screen passes no geometry (tests). */
const UNMEASURED_HEIGHT = 10_000;
/** Each scroll button moves the board by this share of the visible width. */
const SCROLL_STEP_FRACTION = 0.6;
// Tags on drag diagnostics events (#3528): `scrollable` is Large cards on.
const NORMAL_CARD_TAGS: DragDiagnosticTags = { cardSize: "normal" };
const LARGE_CARD_TAGS: DragDiagnosticTags = { cardSize: "large" };

type Selection = FreeCellSelection | null;

export interface FreeCellBoardProps {
  readonly state: FreeCellState;
  /**
   * A legal move. A drop passes where the ghost was let go (`DropOffset`, #3573), so the card
   * settles from there; a tap passes none.
   */
  readonly onMove: (move: Move, offset?: DropOffset) => void;
  /**
   * True while the screen is applying moves on its own (Auto-Complete). Taps
   * and drops are then rejected with the invalid-move feedback instead of
   * being validated against a board that is about to change and silently
   * dropped by `onMove` (#2225).
   */
  readonly inputLocked?: boolean;
  /**
   * The felt's geometry (#3607, `game/freecell/layout.ts`): the gaps, the
   * padding, the top row's card size and the tableau's height. The board picks
   * one face-up step for every column from it (`faceUpStepFor`), so the tallest
   * legal column fits and the board never scrolls vertically. The tableau cards
   * themselves are the `CardSizeContext` size. Omitted (tests): a roomy felt for
   * the context's card.
   */
  readonly geometry?: TableGeometry;
  /**
   * Large cards (#3347): wrap the board in a horizontal ScrollView, so a board
   * wider than the screen can be scrolled. Off: no ScrollView. The free cells
   * and foundations are part of the board and scroll with the tableau, so every
   * column stays under its own top-row slot.
   */
  readonly scrollable?: boolean;
  /**
   * Large cards: whether the board is wider than the felt, so the scroll buttons
   * show (`largeBoardOverflows`; the geometry has already set their strip's
   * height aside). Omitted: from the scroller's measured width.
   */
  readonly overflows?: boolean;
  /** Reduce Motion (#3607): a selected card does not lift. The screen reads the setting once. */
  readonly reduceMotion?: boolean;
}

interface BoardScrollProps {
  readonly overflows: boolean;
  readonly onViewportWidth: (width: number) => void;
  readonly children: React.ReactNode;
}

/**
 * Horizontal scroller for the enlarged board (#3347). The drag ghost is drawn
 * in the root DragGhostHost (#3531), outside this scroller, so it is not
 * scrolled with the board.
 *
 * Drag versus scroll: swiping on the board never scrolls it. The ScrollView is
 * `scrollEnabled={false}` always, so a swipe that starts on a card can only be
 * the card's drag (DraggableCard, shared with Solitaire, is untouched), on iOS
 * and Android alike. The two chevron buttons are the scroll mechanism
 * (`scrollTo`, which works with `scrollEnabled` off); they also serve
 * screen-reader and switch users. Keep it LTR: on web in an RTL language
 * (ar, he) the browser's scroll offsets run negative, and the card order must
 * not flip.
 */
function BoardScroll({ overflows, onViewportWidth, children }: BoardScrollProps) {
  const { t } = useTranslation("freecell");
  const { colors } = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const offsetRef = useRef(0);
  const viewportRef = useRef(0);
  const contentRef = useRef(0);

  /** Keeps the remembered offset inside the board after the viewport or content changes. */
  const clampOffset = useCallback(() => {
    const max = Math.max(0, contentRef.current - viewportRef.current);
    offsetRef.current = Math.min(offsetRef.current, max);
  }, []);
  const handleLayout = useCallback(
    (e: LayoutChangeEvent) => {
      viewportRef.current = e.nativeEvent.layout.width;
      clampOffset();
      onViewportWidth(e.nativeEvent.layout.width);
    },
    [onViewportWidth, clampOffset]
  );
  // The real offset, whatever moved it (a rotation, a resize, a running animation).
  // A ref write only: no render.
  const rememberOffset = useCallback((e: NativeSyntheticEvent<NativeScrollEvent>) => {
    offsetRef.current = e.nativeEvent.contentOffset.x;
  }, []);
  const handleContentSize = useCallback(
    (width: number) => {
      contentRef.current = width;
      clampOffset();
    },
    [clampOffset]
  );
  const scrollBy = useCallback((direction: -1 | 1) => {
    const max = Math.max(0, contentRef.current - viewportRef.current);
    const x = Math.min(
      max,
      Math.max(0, offsetRef.current + direction * viewportRef.current * SCROLL_STEP_FRACTION)
    );
    offsetRef.current = x;
    scrollRef.current?.scrollTo({ x, animated: true });
  }, []);

  return (
    <View style={styles.scrollWrap}>
      {overflows && (
        <View style={styles.scrollBar}>
          {([-1, 1] as const).map((direction) => (
            <Pressable
              key={direction}
              testID={direction < 0 ? "freecell-scroll-left" : "freecell-scroll-right"}
              onPress={() => scrollBy(direction)}
              hitSlop={SCROLL_BUTTON_HIT_SLOP}
              style={[styles.scrollButton, { backgroundColor: colors.surfaceAlt }]}
              accessibilityRole="button"
              accessibilityLabel={
                direction < 0 ? t("a11y.scrollBoardLeft") : t("a11y.scrollBoardRight")
              }
            >
              <MaterialIcons
                name={direction < 0 ? "chevron-left" : "chevron-right"}
                size={24}
                color={colors.text}
              />
            </Pressable>
          ))}
        </View>
      )}
      <ScrollView
        ref={scrollRef}
        testID="freecell-board-hscroll"
        horizontal
        nestedScrollEnabled
        bounces={false}
        showsHorizontalScrollIndicator={overflows}
        scrollEnabled={false}
        scrollEventThrottle={SCROLL_EVENT_THROTTLE_MS}
        onScroll={rememberOffset}
        onLayout={handleLayout}
        onContentSizeChange={handleContentSize}
        contentContainerStyle={styles.scrollContent}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export default function FreeCellBoard({
  state,
  onMove,
  inputLocked = false,
  geometry,
  scrollable = false,
  overflows: overflowsProp,
  reduceMotion = false,
}: FreeCellBoardProps) {
  const { t } = useTranslation("freecell");
  const { cardWidth } = useCardSize();
  // The screen's flight store (#3573): its layer is the board view's last child, inside the
  // Large-cards scroller, so the flights' coordinates are the board's own.
  const flightStore = useContext(CardFlightContext);
  // A won game is over (#3573): while the result card waits for the last landing, the board
  // takes no tap, drag or drop, silently (Auto-Complete's lock, #2225, gives feedback instead).
  const over = state.isComplete;
  /** No drop and no drag target: Auto-Complete's lock, or the game is won. */
  const closed = inputLocked || over;
  const g = useMemo(
    () =>
      geometry ??
      freeCellGeometry({ width: 0, height: UNMEASURED_HEIGHT, largeCardWidth: cardWidth }),
    [geometry, cardWidth]
  );
  const boardWidth = freeCellBoardWidth(cardWidth, g.gap);
  // The top row's cards are a little smaller than the tableau's (#3607).
  const topCardSize = useMemo(
    () => ({ cardWidth: g.topCardWidth, cardHeight: g.topCardHeight }),
    [g.topCardWidth, g.topCardHeight]
  );
  // One face-up step for the whole board: as airy as the tallest column allows.
  const faceUpStep = useMemo(
    () =>
      faceUpStepFor(
        g,
        state.tableau.map((pile) => ({ down: 0, up: pile.length }))
      ),
    [g, state.tableau]
  );
  const [selection, setSelection] = useState<Selection>(null);
  // Where the selection can go (#3607): outlined in green while it is held.
  const targets = useMemo(() => legalTargets(state, selection), [state, selection]);
  const lastTapRef = useRef<{ key: string; time: number } | null>(null);
  const [viewportWidth, setViewportWidth] = useState(0);
  // Scroll buttons (and their strip) only while the board is wider than what is visible.
  const overflows =
    scrollable &&
    (overflowsProp ?? (viewportWidth > 0 && boardWidth + 2 * SCROLL_PAD > viewportWidth + 1));

  const { play: playInvalidMove } = useSound("freecell.invalidMove", FREECELL_SOUNDS);
  const { shakeX, triggerIllegal } = useCardSelection(playInvalidMove);
  // Read by the drag provider's rejection callback, which it keeps in a ref of its own.
  const overRef = useRef(over);
  useEffect(() => {
    overRef.current = over;
  }, [over]);

  /** Rejects a tap while input is locked, or ignores it once the game is won; true to stop. */
  function rejectIfLocked(): boolean {
    if (over) return true;
    if (!inputLocked) return false;
    triggerIllegal();
    return true;
  }

  /** Whether a tableau selection is its column's top card (not a run). */
  function isColumnTop(sel: { readonly col: number; readonly index: number }): boolean {
    return sel.index === (state.tableau[sel.col]?.length ?? 0) - 1;
  }

  function tryMove(move: Move) {
    if (validateMove(state, move)) {
      onMove(move);
      setSelection(null);
    } else {
      triggerIllegal();
    }
  }

  function handleTableauCardPress(col: number, index: number) {
    if (rejectIfLocked()) return;
    const pile = state.tableau[col];
    if (pile === undefined) return;
    const card = pile[index];
    if (card === undefined) return;

    const key = `tableau:${col}:${index}`;
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = last !== null && last.key === key && now - last.time < DOUBLE_TAP_MS;
    lastTapRef.current = { key, time: now };

    // FreeCell cards are always face-up; no faceUp guard needed (contrast Solitaire).
    if (isDouble && index === pile.length - 1) {
      tryMove({ type: "tableau-to-foundation", fromCol: col });
      return;
    }

    if (selection === null) {
      setSelection({ kind: "tableau", col, index });
      return;
    }
    if (selection.kind === "tableau" && selection.col === col && selection.index === index) {
      setSelection(null);
      return;
    }
    const move: Move =
      selection.kind === "tableau"
        ? {
            type: "tableau-to-tableau",
            fromCol: selection.col,
            fromIndex: selection.index,
            toCol: col,
          }
        : selection.kind === "freecell"
          ? { type: "freecell-to-tableau", fromCell: selection.cell, toCol: col }
          : { type: "foundation-to-tableau", fromSuit: selection.suit, toCol: col };
    // An illegal destination is rejected with feedback and the selection is
    // kept, so the obvious next tap on a legal destination still moves the
    // selected card (#1563). The tap is still recorded in `lastTapRef` above,
    // so a second tap on this same card within DOUBLE_TAP_MS completes a
    // double-tap to the foundation for it (#2225) — the double-tap check runs
    // before any selection handling.
    tryMove(move);
  }

  function handleTableauEmptyPress(col: number) {
    if (rejectIfLocked()) return;
    if (selection === null) return;
    if (selection.kind === "tableau") {
      tryMove({
        type: "tableau-to-tableau",
        fromCol: selection.col,
        fromIndex: selection.index,
        toCol: col,
      });
    } else if (selection.kind === "freecell") {
      tryMove({ type: "freecell-to-tableau", fromCell: selection.cell, toCol: col });
    } else {
      tryMove({ type: "foundation-to-tableau", fromSuit: selection.suit, toCol: col });
    }
  }

  function handleFreeCellPress(cell: number) {
    if (rejectIfLocked()) return;
    const key = `freecell:${cell}`;
    const now = Date.now();
    const last = lastTapRef.current;
    const isDouble = last !== null && last.key === key && now - last.time < DOUBLE_TAP_MS;
    lastTapRef.current = { key, time: now };

    if (isDouble && state.freeCells[cell] !== null) {
      tryMove({ type: "freecell-to-foundation", fromCell: cell });
      return;
    }

    if (selection === null) {
      if (state.freeCells[cell] !== null) {
        setSelection({ kind: "freecell", cell });
      }
      return;
    }
    if (selection.kind === "freecell" && selection.cell === cell) {
      setSelection(null);
      return;
    }
    if (selection.kind === "tableau") {
      // A run never goes to a free cell (#3607): the outlines and the drag say so, and
      // the engine's move would take the column's top card instead of the selection.
      if (!isColumnTop(selection)) {
        triggerIllegal();
        return;
      }
      // An occupied cell is rejected and the selection kept; tapping it again
      // within DOUBLE_TAP_MS still sends its card to the foundation (#2225).
      tryMove({ type: "tableau-to-freecell", fromCol: selection.col, toCell: cell });
    } else {
      setSelection(null); // freecell-to-freecell and foundation-to-freecell are not valid moves
    }
  }

  function handleFoundationPress(suit: Suit) {
    if (rejectIfLocked()) return;
    if (selection === null) {
      if (state.foundations[suit].length > 0) {
        setSelection({ kind: "foundation", suit });
      }
      return;
    }
    if (selection.kind === "foundation") {
      if (selection.suit === suit) {
        setSelection(null);
      } else {
        setSelection({ kind: "foundation", suit });
      }
      return;
    }
    if (selection.kind === "tableau") {
      // Only a column's top card goes to a foundation, never a run (#3607).
      if (!isColumnTop(selection)) {
        triggerIllegal();
        return;
      }
      tryMove({ type: "tableau-to-foundation", fromCol: selection.col });
    } else {
      tryMove({ type: "freecell-to-foundation", fromCell: selection.cell });
    }
  }

  // ── Drag-and-drop handlers ──────────────────────────────────────────────────

  const handleDropToTableau = useCallback(
    (source: DragSource, toCol: number, offset?: DropOffset): boolean => {
      if (closed || source.game !== "freecell") return false;
      if (source.type === "tableau") {
        if (
          !validateMove(state, {
            type: "tableau-to-tableau",
            fromCol: source.col,
            fromIndex: source.fromIndex,
            toCol,
          })
        )
          return false;
        onMove(
          {
            type: "tableau-to-tableau",
            fromCol: source.col,
            fromIndex: source.fromIndex,
            toCol,
          },
          offset
        );
        setSelection(null);
        return true;
      }
      if (source.type === "freecell") {
        if (!validateMove(state, { type: "freecell-to-tableau", fromCell: source.cell, toCol }))
          return false;
        onMove({ type: "freecell-to-tableau", fromCell: source.cell, toCol }, offset);
        setSelection(null);
        return true;
      }
      if (source.type === "foundation") {
        if (
          !validateMove(state, {
            type: "foundation-to-tableau",
            fromSuit: source.suit as Suit,
            toCol,
          })
        )
          return false;
        onMove({ type: "foundation-to-tableau", fromSuit: source.suit as Suit, toCol }, offset);
        setSelection(null);
        return true;
      }
      return false;
    },
    [state, onMove, closed]
  );

  const handleDropToFoundation = useCallback(
    (source: DragSource, offset?: DropOffset): boolean => {
      if (closed || source.game !== "freecell") return false;
      if (source.type === "tableau") {
        if (!validateMove(state, { type: "tableau-to-foundation", fromCol: source.col }))
          return false;
        onMove({ type: "tableau-to-foundation", fromCol: source.col }, offset);
        setSelection(null);
        return true;
      }
      if (source.type === "freecell") {
        if (!validateMove(state, { type: "freecell-to-foundation", fromCell: source.cell }))
          return false;
        onMove({ type: "freecell-to-foundation", fromCell: source.cell }, offset);
        setSelection(null);
        return true;
      }
      return false;
    },
    [state, onMove, closed]
  );

  const handleDropToFreeCell = useCallback(
    (source: DragSource, toCell: number, offset?: DropOffset): boolean => {
      if (closed || source.game !== "freecell" || source.type !== "tableau") return false;
      if (!validateMove(state, { type: "tableau-to-freecell", fromCol: source.col, toCell }))
        return false;
      onMove({ type: "tableau-to-freecell", fromCol: source.col, toCell }, offset);
      setSelection(null);
      return true;
    },
    [state, onMove, closed]
  );

  const getLegalDropIds = useCallback(
    (source: DragSource, cards: DragCard[]): string[] => {
      if (closed || source.game !== "freecell") return [];
      const ids: string[] = [];

      // Tableau columns.
      for (let col = 0; col < TABLEAU_COLS; col++) {
        let move: Move | null = null;
        if (source.type === "tableau" && source.col !== col) {
          move = {
            type: "tableau-to-tableau",
            fromCol: source.col,
            fromIndex: source.fromIndex,
            toCol: col,
          };
        } else if (source.type === "freecell") {
          move = { type: "freecell-to-tableau", fromCell: source.cell, toCol: col };
        } else if (source.type === "foundation") {
          move = { type: "foundation-to-tableau", fromSuit: source.suit as Suit, toCol: col };
        }
        if (move && validateMove(state, move)) ids.push(`freecell-tableau-${col}`);
      }

      // Free cell slots (single-card only).
      if (cards.length === 1 && source.type === "tableau") {
        for (let cell = 0; cell < 4; cell++) {
          if (
            validateMove(state, { type: "tableau-to-freecell", fromCol: source.col, toCell: cell })
          ) {
            ids.push(`freecell-slot-${cell}`);
          }
        }
      }

      // Foundation (single-card only).
      if (cards.length === 1) {
        let foundMove: Move | null = null;
        if (source.type === "tableau")
          foundMove = { type: "tableau-to-foundation", fromCol: source.col };
        else if (source.type === "freecell")
          foundMove = { type: "freecell-to-foundation", fromCell: source.cell };
        if (foundMove && validateMove(state, foundMove)) {
          for (const suit of SUITS) ids.push(`freecell-foundation-${suit}`);
        }
      }

      return ids;
    },
    [state, closed]
  );

  const hint = state.hint;
  const hintDestFoundationSuit: string | undefined = (() => {
    if (!hint) return undefined;
    if (hint.type === "tableau-to-foundation") {
      const col = state.tableau[hint.fromCol];
      return col && col.length > 0 ? col[col.length - 1]!.suit : undefined;
    }
    if (hint.type === "freecell-to-foundation") {
      return state.freeCells[hint.fromCell]?.suit ?? undefined;
    }
    return undefined;
  })();
  const hintDestFreeCellIndex: number | undefined =
    hint?.type === "tableau-to-freecell" ? hint.toCell : undefined;
  const hintDestTableauCol: number | undefined =
    hint?.type === "tableau-to-tableau" || hint?.type === "freecell-to-tableau"
      ? hint.toCol
      : undefined;

  const boardView = (
    <View
      style={[styles.board, { width: boardWidth, paddingTop: g.padding }]}
      accessibilityRole="none"
      accessibilityLabel={t("a11y.boardRegion")}
    >
      {/* The free cells and foundations: one slot over each column (#3607), a little smaller. */}
      <CardSizeContext.Provider value={topCardSize}>
        <View
          testID="freecell-top-row"
          style={[styles.topRow, { gap: g.gap, marginBottom: g.rowGap }]}
        >
          {state.freeCells.map((card, i) => (
            <View key={`cell-${i}`} style={{ width: cardWidth }}>
              <FreeCellSlot
                card={card}
                cellIndex={i}
                selected={selection?.kind === "freecell" && selection.cell === i}
                shakeX={selection?.kind === "freecell" && selection.cell === i ? shakeX : undefined}
                hintSource={
                  (state.hint?.type === "freecell-to-tableau" && state.hint.fromCell === i) ||
                  (state.hint?.type === "freecell-to-foundation" && state.hint.fromCell === i)
                }
                hintDestination={hintDestFreeCellIndex === i}
                legalTarget={targets.cells.has(i)}
                canMoveHereHint={t("pile.canMoveHere")}
                reduceMotion={reduceMotion}
                onPress={handleFreeCellPress}
                dropId={`freecell-slot-${i}`}
                locked={over}
                onDrop={(source, _cards, offset) => handleDropToFreeCell(source, i, offset)}
              />
            </View>
          ))}
          {SUITS.map((suit) => (
            <View key={suit} style={{ width: cardWidth }}>
              <FoundationPile
                pile={state.foundations[suit]}
                suit={suit}
                selected={selection?.kind === "foundation" && selection.suit === suit}
                shakeX={
                  selection?.kind === "foundation" && selection.suit === suit ? shakeX : undefined
                }
                hintDestination={hintDestFoundationSuit === suit}
                legalTarget={targets.suits.has(suit)}
                reduceMotion={reduceMotion}
                onPress={() => handleFoundationPress(suit)}
                dropId={`freecell-foundation-${suit}`}
                locked={over}
                onDrop={(source, _cards, offset) => handleDropToFoundation(source, offset)}
              />
            </View>
          ))}
        </View>
      </CardSizeContext.Provider>

      <View style={[styles.tableau, { gap: g.gap }]}>
        {state.tableau.map((pile, col) => (
          <TableauColumn
            key={col}
            pile={pile}
            colIndex={col}
            faceUpOffset={faceUpStep}
            selectedIndex={
              selection?.kind === "tableau" && selection.col === col ? selection.index : undefined
            }
            shakeX={selection?.kind === "tableau" && selection.col === col ? shakeX : undefined}
            hintIndex={
              (state.hint?.type === "tableau-to-tableau" ||
                state.hint?.type === "tableau-to-freecell" ||
                state.hint?.type === "tableau-to-foundation") &&
              state.hint.fromCol === col
                ? state.hint.type === "tableau-to-tableau"
                  ? state.hint.fromIndex
                  : pile.length - 1
                : undefined
            }
            hintDestination={hintDestTableauCol === col}
            legalTarget={targets.cols.has(col)}
            reduceMotion={reduceMotion}
            onCardPress={handleTableauCardPress}
            onEmptyPress={handleTableauEmptyPress}
            dropId={`freecell-tableau-${col}`}
            locked={over}
            onDrop={(source, _cards, offset) => handleDropToTableau(source, col, offset)}
          />
        ))}
      </View>
      {/* Last, so a card in flight draws above every pile (#3573). */}
      {flightStore !== null ? <CardFlightLayer store={flightStore} /> : null}
    </View>
  );

  return (
    <DragProvider
      getLegalDropIds={getLegalDropIds}
      onDropRejected={() => {
        // A won game's board is over: a drop on it goes quietly (#3573).
        if (!overRef.current) playInvalidMove();
      }}
      diagnosticTags={scrollable ? LARGE_CARD_TAGS : NORMAL_CARD_TAGS}
    >
      <DragContainer style={scrollable ? styles.stretch : undefined}>
        {scrollable ? (
          <BoardScroll overflows={overflows} onViewportWidth={setViewportWidth}>
            {boardView}
          </BoardScroll>
        ) : (
          boardView
        )}
      </DragContainer>
    </DragProvider>
  );
}

const styles = StyleSheet.create({
  // Gives the scroller a bounded width (its parent centres its children).
  stretch: {
    alignSelf: "stretch",
  },
  scrollWrap: {
    alignSelf: "stretch",
    direction: "ltr",
  },
  scrollBar: {
    height: SCROLL_BAR_HEIGHT,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    // Clear of the felt's rounded corners.
    paddingHorizontal: 8,
  },
  scrollButton: {
    width: SCROLL_BUTTON_WIDTH,
    height: SCROLL_BUTTON_HEIGHT,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  // Fills the viewport and centres a board narrower than it (a wide tablet).
  scrollContent: {
    flexGrow: 1,
    justifyContent: "center",
    padding: SCROLL_PAD,
    direction: "ltr",
  },
  board: {
    alignItems: "flex-start",
  },
  // Each slot sits at its column's left edge, as in the mockup.
  topRow: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
  tableau: {
    flexDirection: "row",
    alignItems: "flex-start",
  },
});
