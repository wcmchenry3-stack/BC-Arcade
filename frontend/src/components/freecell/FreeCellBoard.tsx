import React, { useCallback, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";

import { useTheme } from "../../theme/ThemeContext";

import { SUITS } from "../../game/freecell/types";
import { validateMove } from "../../game/freecell/engine";
import type { FreeCellState, Move, Suit } from "../../game/freecell/types";
import FreeCellSlot from "./FreeCellSlot";
import FoundationPile from "./FoundationPile";
import TableauColumn from "./TableauColumn";
import { useCardSize } from "../../game/_shared/CardSizeContext";
import { DragProvider } from "../../game/_shared/drag/DragContext";
import { DragContainer } from "../../game/_shared/drag/DragContainer";
import type { DragSource, DragCard } from "../../game/_shared/drag/DragContext";
import { useSound } from "../../game/_shared/useSound";
import { useCardSelection } from "../../game/_shared/useCardSelection";

const TABLEAU_COLS = 8;
const COL_GAP = 2;
const ROW_GAP = 8;
// Tighter than COL_GAP so space-between produces a natural ~8px gap between groups
const TOP_GROUP_GAP = 1;
const DOUBLE_TAP_MS = 300;

type Selection =
  | { kind: "tableau"; col: number; index: number }
  | { kind: "freecell"; cell: number }
  | { kind: "foundation"; suit: Suit }
  | null;

export interface FreeCellBoardProps {
  readonly state: FreeCellState;
  readonly onMove: (move: Move) => void;
}

export default function FreeCellBoard({ state, onMove }: FreeCellBoardProps) {
  const { t } = useTranslation("freecell");
  const { colors } = useTheme();
  const { cardWidth } = useCardSize();
  const boardWidth = TABLEAU_COLS * cardWidth + (TABLEAU_COLS - 1) * COL_GAP;
  const [selection, setSelection] = useState<Selection>(null);
  const lastTapRef = useRef<{ key: string; time: number } | null>(null);

  const { play: playInvalidMove } = useSound("freecell.invalidMove");
  const { shakeX, triggerIllegal } = useCardSelection(playInvalidMove);

  function tryMove(move: Move) {
    if (validateMove(state, move)) {
      onMove(move);
      setSelection(null);
    } else {
      triggerIllegal();
    }
  }

  function handleTableauCardPress(col: number, index: number) {
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

  function handleTableauEmptyPress(col: number) {
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
      tryMove({ type: "tableau-to-freecell", fromCol: selection.col, toCell: cell });
    } else {
      setSelection(null); // freecell-to-freecell and foundation-to-freecell are not valid moves
    }
  }

  function handleFoundationPress(suit: Suit) {
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
      tryMove({ type: "tableau-to-foundation", fromCol: selection.col });
    } else {
      tryMove({ type: "freecell-to-foundation", fromCell: selection.cell });
    }
  }

  // ── Drag-and-drop handlers ──────────────────────────────────────────────────

  const handleDropToTableau = useCallback(
    (source: DragSource, toCol: number): boolean => {
      if (source.game !== "freecell") return false;
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
        onMove({
          type: "tableau-to-tableau",
          fromCol: source.col,
          fromIndex: source.fromIndex,
          toCol,
        });
        return true;
      }
      if (source.type === "freecell") {
        if (!validateMove(state, { type: "freecell-to-tableau", fromCell: source.cell, toCol }))
          return false;
        onMove({ type: "freecell-to-tableau", fromCell: source.cell, toCol });
        return true;
      }
      return false;
    },
    [state, onMove]
  );

  const handleDropToFoundation = useCallback(
    (source: DragSource): boolean => {
      if (source.game !== "freecell") return false;
      if (source.type === "tableau") {
        if (!validateMove(state, { type: "tableau-to-foundation", fromCol: source.col }))
          return false;
        onMove({ type: "tableau-to-foundation", fromCol: source.col });
        return true;
      }
      if (source.type === "freecell") {
        if (!validateMove(state, { type: "freecell-to-foundation", fromCell: source.cell }))
          return false;
        onMove({ type: "freecell-to-foundation", fromCell: source.cell });
        return true;
      }
      return false;
    },
    [state, onMove]
  );

  const handleDropToFreeCell = useCallback(
    (source: DragSource, toCell: number): boolean => {
      if (source.game !== "freecell" || source.type !== "tableau") return false;
      if (!validateMove(state, { type: "tableau-to-freecell", fromCol: source.col, toCell }))
        return false;
      onMove({ type: "tableau-to-freecell", fromCol: source.col, toCell });
      return true;
    },
    [state, onMove]
  );

  const getLegalDropIds = useCallback(
    (source: DragSource, cards: DragCard[]): string[] => {
      if (source.game !== "freecell") return [];
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
    [state]
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

  return (
    <DragProvider getLegalDropIds={getLegalDropIds}>
      <DragContainer>
        <View
          style={styles.board}
          accessibilityRole="none"
          accessibilityLabel={t("a11y.boardRegion")}
        >
          <View
            style={[
              styles.topRow,
              {
                width: boardWidth,
                borderBottomWidth: 1,
                borderBottomColor: colors.border,
                paddingTop: 6,
                paddingBottom: 8,
              },
            ]}
          >
            <View style={styles.topGroup}>
              {state.freeCells.map((card, i) => (
                <FreeCellSlot
                  key={i}
                  card={card}
                  cellIndex={i}
                  selected={selection?.kind === "freecell" && selection.cell === i}
                  shakeX={selection?.kind === "freecell" && selection.cell === i ? shakeX : undefined}
                  hintSource={
                    (state.hint?.type === "freecell-to-tableau" && state.hint.fromCell === i) ||
                    (state.hint?.type === "freecell-to-foundation" && state.hint.fromCell === i)
                  }
                  hintDestination={hintDestFreeCellIndex === i}
                  onPress={handleFreeCellPress}
                  dropId={`freecell-slot-${i}`}
                  onDrop={(source) => handleDropToFreeCell(source, i)}
                />
              ))}
            </View>
            <View style={styles.topGroup}>
              {SUITS.map((suit) => (
                <FoundationPile
                  key={suit}
                  pile={state.foundations[suit]}
                  suit={suit}
                  selected={selection?.kind === "foundation" && selection.suit === suit}
                  shakeX={
                    selection?.kind === "foundation" && selection.suit === suit ? shakeX : undefined
                  }
                  hintDestination={hintDestFoundationSuit === suit}
                  onPress={() => handleFoundationPress(suit)}
                  dropId={`freecell-foundation-${suit}`}
                  onDrop={(source) => handleDropToFoundation(source)}
                />
              ))}
            </View>
          </View>

          <View style={styles.tableau}>
            {state.tableau.map((pile, col) => (
              <TableauColumn
                key={col}
                pile={pile}
                colIndex={col}
                selectedIndex={
                  selection?.kind === "tableau" && selection.col === col
                    ? selection.index
                    : undefined
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
                onCardPress={handleTableauCardPress}
                onEmptyPress={handleTableauEmptyPress}
                dropId={`freecell-tableau-${col}`}
                onDrop={(source) => handleDropToTableau(source, col)}
              />
            ))}
          </View>
        </View>
      </DragContainer>
    </DragProvider>
  );
}

const styles = StyleSheet.create({
  board: {
    alignItems: "center",
    gap: ROW_GAP,
  },
  topRow: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  topGroup: {
    flexDirection: "row",
    gap: TOP_GROUP_GAP,
  },
  tableau: {
    flexDirection: "row",
    gap: COL_GAP,
    alignItems: "flex-start",
  },
});
