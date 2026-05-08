/**
 * DragPrototypeScreen — isolated drag-drop test harness for iOS debugging.
 * Part of epic #1329 / story #1334.
 *
 * Renders 7 static piles with 10 total draggable cards using the shared
 * DragContext + DraggableCard infrastructure. All drag lifecycle events are
 * logged to a visible panel and to the console so they can be traced on a
 * physical iOS device via Xcode/Metro.
 *
 * Gate: this file is only ever imported under __DEV__ checks. Do not route
 * to it in production builds.
 */

import React, { useCallback, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { CardSizeContext } from "../../game/_shared/CardSizeContext";
import { DragContainer } from "../../game/_shared/drag/DragContainer";
import { DragProvider } from "../../game/_shared/drag/DragContext";
import { DraggableCard } from "../../game/_shared/drag/DraggableCard";
import { DropTarget } from "../../game/_shared/drag/DropTarget";
import SharedPlayingCard from "../../components/shared/PlayingCard";
import type { DragCard, DragSource, DropHandler } from "../../game/_shared/drag/DragContext";
import type { CanonicalSuit } from "../../game/_shared/decks/types";

if (!__DEV__) {
  throw new Error("DragPrototypeScreen must not be used in production builds");
}

// ─── Static card data ─────────────────────────────────────────────────────────

type CardDef = { suit: CanonicalSuit; rank: number };

const INITIAL_PILES: CardDef[][] = [
  [
    { suit: "spades", rank: 1 },
    { suit: "hearts", rank: 2 },
  ],
  [{ suit: "diamonds", rank: 3 }],
  [
    { suit: "clubs", rank: 4 },
    { suit: "spades", rank: 5 },
  ],
  [{ suit: "hearts", rank: 6 }],
  [
    { suit: "diamonds", rank: 7 },
    { suit: "clubs", rank: 8 },
  ],
  [{ suit: "spades", rank: 9 }],
  [{ suit: "hearts", rank: 10 }],
];

const CARD_W = 64;
const CARD_H = 90;
const PILE_GAP = 10;
const STACK_OFFSET = 28;
const MAX_LOG_LINES = 40;

// ─── Component ────────────────────────────────────────────────────────────────

export function DragPrototypeScreen() {
  const [piles, setPiles] = useState<CardDef[][]>(INITIAL_PILES);
  const [selected, setSelected] = useState<{ pile: number; card: number } | null>(null);
  const [log, setLog] = useState<string[]>(["[ready] tap or drag a card"]);

  const addLog = useCallback((msg: string) => {
    const ts = new Date().toISOString().slice(11, 23);
    const line = `[${ts}] ${msg}`;
    console.log("[DragProto]", line);
    setLog((prev) => [line, ...prev].slice(0, MAX_LOG_LINES));
  }, []);

  // ── Drag lifecycle ───────────────────────────────────────────────────────────

  const getLegalDropIds = useCallback(
    (source: DragSource): string[] => {
      addLog(`drag-start source=${JSON.stringify(source)}`);
      // Accept drops on every pile that isn't the source pile.
      const sourcePile = source.type === "tableau" ? source.col : -1;
      return Array.from({ length: 7 }, (_, i) => `proto-pile-${i}`).filter(
        (id) => id !== `proto-pile-${sourcePile}`
      );
    },
    [addLog]
  );

  const handleDrop = useCallback(
    (toPile: number): DropHandler =>
      (source: DragSource, cards: DragCard[]) => {
        addLog(`drop pile=${toPile} cards=${cards.length} src=${JSON.stringify(source)}`);
        if (source.type !== "tableau") return false;
        const fromPile = source.col;
        const fromIndex = source.fromIndex;
        setPiles((prev) => {
          const next = prev.map((p) => [...p]);
          const moved = next[fromPile]?.splice(fromIndex) ?? [];
          next[toPile]?.push(...moved);
          return next;
        });
        return true;
      },
    [addLog]
  );

  // ── Tap-to-select fallback ───────────────────────────────────────────────────

  const handleTap = useCallback(
    (pileIdx: number, cardIdx: number) => {
      addLog(`tap pile=${pileIdx} card=${cardIdx}`);
      if (selected === null) {
        setSelected({ pile: pileIdx, card: cardIdx });
        return;
      }
      if (selected.pile === pileIdx) {
        setSelected(null);
        return;
      }
      // Move selected cards to tapped pile
      setPiles((prev) => {
        const next = prev.map((p) => [...p]);
        const moved = next[selected.pile]?.splice(selected.card) ?? [];
        next[pileIdx]?.push(...moved);
        return next;
      });
      addLog(`tap-move pile=${selected.pile}[${selected.card}] → pile=${pileIdx}`);
      setSelected(null);
    },
    [selected, addLog]
  );

  // ── Render ───────────────────────────────────────────────────────────────────

  const cardSize = { cardWidth: CARD_W, cardHeight: CARD_H };

  return (
    <CardSizeContext.Provider value={cardSize}>
      <DragProvider getLegalDropIds={getLegalDropIds}>
        <View style={styles.root}>
          <Text style={styles.header}>Drag Prototype {Platform.OS}</Text>

          <DragContainer style={styles.board}>
            <View style={styles.pilesRow}>
              {piles.map((pile, pileIdx) => {
                const containerH = CARD_H + (pile.length > 1 ? (pile.length - 1) * STACK_OFFSET : 0);
                const pileContent = (
                  <View style={[styles.pileContainer, { width: CARD_W, height: containerH }]}>
                    {pile.length === 0 ? (
                      <View style={[styles.emptySlot, { width: CARD_W, height: CARD_H }]} />
                    ) : (
                      pile.map((card, cardIdx) => {
                        const isSelected =
                          selected?.pile === pileIdx && cardIdx >= (selected?.card ?? 0);
                        const dragCards: DragCard[] = pile.slice(cardIdx).map((c) => ({
                          suit: c.suit,
                          rank: c.rank,
                          faceDown: false,
                          width: CARD_W,
                          height: CARD_H,
                        }));
                        return (
                          <DraggableCard
                            key={cardIdx}
                            style={[styles.cardSlot, { top: cardIdx * STACK_OFFSET }]}
                            onTap={() => handleTap(pileIdx, cardIdx)}
                            dragCards={dragCards}
                            dragSource={{
                              game: "solitaire",
                              type: "tableau",
                              col: pileIdx,
                              fromIndex: cardIdx,
                            }}
                            draggable
                          >
                            <View
                              style={[
                                styles.cardWrap,
                                isSelected && styles.cardSelected,
                                { width: CARD_W, height: CARD_H },
                              ]}
                            >
                              <SharedPlayingCard
                                suit={card.suit}
                                rank={card.rank}
                                faceDown={false}
                                width={CARD_W}
                                height={CARD_H}
                              />
                            </View>
                          </DraggableCard>
                        );
                      })
                    )}
                  </View>
                );
                return (
                  <DropTarget
                    key={pileIdx}
                    id={`proto-pile-${pileIdx}`}
                    onDrop={handleDrop(pileIdx)}
                    style={{ marginHorizontal: PILE_GAP / 2 }}
                    highlightStyle={styles.dropHighlight}
                    dimStyle={styles.dropDim}
                  >
                    {pileContent}
                  </DropTarget>
                );
              })}
            </View>
          </DragContainer>

          <View style={styles.logPanel}>
            <Text style={styles.logHeader}>Gesture log (newest first)</Text>
            <ScrollView style={styles.logScroll} showsVerticalScrollIndicator>
              {log.map((line, i) => (
                <Text key={i} style={styles.logLine}>
                  {line}
                </Text>
              ))}
            </ScrollView>
          </View>
        </View>
      </DragProvider>
    </CardSizeContext.Provider>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#1a1a2e",
    paddingTop: 48,
    paddingHorizontal: 8,
  },
  header: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "700",
    textAlign: "center",
    marginBottom: 12,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  board: {
    flexShrink: 0,
  },
  pilesRow: {
    flexDirection: "row",
    justifyContent: "center",
    paddingHorizontal: 4,
  },
  pileContainer: {
    position: "relative",
  },
  emptySlot: {
    borderRadius: 6,
    borderWidth: 1,
    borderStyle: "dashed",
    borderColor: "#444",
  },
  cardSlot: {
    position: "absolute",
    left: 0,
  },
  cardWrap: {
    borderRadius: 6,
    overflow: "hidden",
  },
  cardSelected: {
    borderWidth: 2,
    borderColor: "#7c3aed",
    borderRadius: 6,
  },
  dropHighlight: {
    borderWidth: 2,
    borderColor: "#7c3aed",
    borderRadius: 8,
  },
  dropDim: {
    opacity: 0.4,
  },
  logPanel: {
    flex: 1,
    marginTop: 12,
    backgroundColor: "#0d0d1a",
    borderRadius: 8,
    padding: 8,
  },
  logHeader: {
    color: "#888",
    fontSize: 11,
    fontWeight: "600",
    letterSpacing: 0.5,
    marginBottom: 4,
    textTransform: "uppercase",
  },
  logScroll: {
    flex: 1,
  },
  logLine: {
    color: "#aef",
    fontSize: 10,
    fontFamily: Platform.OS === "ios" ? "Menlo" : "monospace",
    lineHeight: 16,
  },
});
