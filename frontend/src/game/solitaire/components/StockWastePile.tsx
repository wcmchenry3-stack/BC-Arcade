/**
 * StockWastePile (#595) — the stock and waste piles rendered side by side.
 *
 * Stateless. Two callbacks: `onStockPress` drives draw/recycle (the parent
 * screen decides which), and `onWastePress` selects the top of the waste.
 * The stock is always face-down; when empty it shows a recycle symbol so
 * the player knows they can recycle. Waste shows only its top card
 * face-up (matches tap-target semantics — the player can only play the
 * top waste card).
 */

import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";

import { useTheme } from "../../../theme/ThemeContext";
import type { Card, DrawMode } from "../types";
import type { CanonicalSuit } from "../../_shared/decks/types";
import { CARD_WIDTH } from "./CardView";
import { useCardSize } from "../../_shared/CardSizeContext";
import { rankLabel } from "../../_shared/decks/cardId";
import { DraggableCard } from "../../_shared/drag/DraggableCard";
import SelectableCard from "../../_shared/SelectableCard";
import type { SharedValue } from "react-native-reanimated";

export interface StockWastePileProps {
  readonly stock: readonly Card[];
  readonly waste: readonly Card[];
  readonly drawMode: DrawMode;
  readonly wasteSelected?: boolean;
  readonly hintSource?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly onStockPress?: () => void;
  readonly onWastePress?: () => void;
}

export default function StockWastePile({
  stock,
  waste,
  drawMode,
  wasteSelected = false,
  hintSource = false,
  shakeX,
  onStockPress,
  onWastePress,
}: StockWastePileProps) {
  const { colors } = useTheme();
  const { t } = useTranslation("solitaire");

  return (
    <View style={styles.row}>
      <Stock
        count={stock.length}
        colors={colors}
        onPress={onStockPress}
        drawMode={drawMode}
        t={t}
      />
      <Waste
        waste={waste}
        drawMode={drawMode}
        selected={wasteSelected}
        hintSource={hintSource}
        shakeX={shakeX}
        onPress={onWastePress}
        t={t}
        colors={colors}
      />
    </View>
  );
}

function Stock({
  count,
  colors,
  onPress,
  drawMode,
  t,
}: {
  readonly count: number;
  readonly colors: ReturnType<typeof useTheme>["colors"];
  readonly onPress?: () => void;
  readonly drawMode: DrawMode;
  readonly t: TFunction<"solitaire">;
}) {
  const { cardWidth, cardHeight } = useCardSize();
  const isEmpty = count === 0;
  const label = isEmpty
    ? t("pile.stock.empty", { count: drawMode })
    : t("pile.stock.label", { count: drawMode, remaining: count });

  const style = [
    styles.slot,
    {
      width: cardWidth,
      height: cardHeight,
      backgroundColor: isEmpty ? colors.background : colors.surfaceAlt,
      borderColor: colors.border,
      borderWidth: 1,
      borderStyle: isEmpty ? ("dashed" as const) : ("solid" as const),
    },
  ];

  const content = isEmpty ? (
    <Text style={[styles.recycleSymbol, { color: colors.textMuted }]}>↻</Text>
  ) : (
    <Text style={[styles.countText, { color: colors.textMuted }]}>{count}</Text>
  );

  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        style={style}
        accessibilityRole="button"
        accessibilityLabel={label}
        testID="solitaire-stock-pile"
      >
        {content}
      </Pressable>
    );
  }
  return (
    <View style={style} accessibilityRole="image" accessibilityLabel={label}>
      {content}
    </View>
  );
}

const WASTE_FAN_OFFSET = 16;

function Waste({
  waste,
  drawMode,
  selected,
  hintSource = false,
  shakeX,
  onPress,
  t,
  colors,
}: {
  readonly waste: readonly Card[];
  readonly drawMode: DrawMode;
  readonly selected: boolean;
  readonly hintSource?: boolean;
  readonly shakeX?: SharedValue<number>;
  readonly onPress?: () => void;
  readonly t: TFunction<"solitaire">;
  readonly colors: ReturnType<typeof useTheme>["colors"];
}) {
  const { cardWidth, cardHeight } = useCardSize();
  const wasteFanOffset = Math.round(WASTE_FAN_OFFSET * (cardWidth / CARD_WIDTH));

  if (waste.length === 0) {
    return (
      <View
        style={{ width: cardWidth, height: cardHeight }}
        accessibilityRole="image"
        accessibilityLabel={t("pile.waste.empty")}
      />
    );
  }

  const top = waste[waste.length - 1]!;
  const topDragCards = [
    {
      suit: top.suit as CanonicalSuit,
      rank: top.rank,
      faceDown: false,
      width: cardWidth,
      height: cardHeight,
    },
  ];

  const topLabel = t("card.faceUp", {
    rank: rankLabel(top.rank),
    suit: t(`suit.${top.suit}` as const),
  });

  if (drawMode !== 3) {
    return (
      <View style={hintSource ? { borderColor: colors.bonus, borderWidth: 3, borderRadius: 8 } : undefined}>
        <DraggableCard
          testID="solitaire-waste-top"
          onTap={onPress}
          dragCards={topDragCards}
          dragSource={{ game: "solitaire", type: "waste" }}
        >
          <SelectableCard
            suit={top.suit as CanonicalSuit}
            rank={top.rank}
            width={cardWidth}
            height={cardHeight}
            selected={selected}
            shakeX={shakeX}
            accessibilityLabel={topLabel}
          />
        </DraggableCard>
      </View>
    );
  }

  const visibleCount = Math.min(3, waste.length);
  const visible = waste.slice(waste.length - visibleCount);
  const containerWidth = 2 * wasteFanOffset + cardWidth;

  return (
    <View style={[styles.wasteFanContainer, { width: containerWidth, height: cardHeight }]}>
      {visible.map((card, i) => {
        const isTop = i === visible.length - 1;
        const label = t("card.faceUp", {
          rank: rankLabel(card.rank),
          suit: t(`suit.${card.suit}` as const),
        });
        if (isTop) {
          return (
            <View
              key={`${card.suit}-${card.rank}`}
              style={[styles.wasteFanCard, { left: i * wasteFanOffset }]}
            >
              <DraggableCard
                testID="solitaire-waste-top"
                onTap={onPress}
                dragCards={topDragCards}
                dragSource={{ game: "solitaire", type: "waste" }}
              >
                <SelectableCard
                  suit={card.suit as CanonicalSuit}
                  rank={card.rank}
                  width={cardWidth}
                  height={cardHeight}
                  selected={selected}
                  shakeX={shakeX}
                  accessibilityLabel={label}
                />
              </DraggableCard>
            </View>
          );
        }
        return (
          <View
            key={`${card.suit}-${card.rank}`}
            style={[styles.wasteFanCard, { left: i * wasteFanOffset }]}
          >
            <SelectableCard
              suit={card.suit as CanonicalSuit}
              rank={card.rank}
              width={cardWidth}
              height={cardHeight}
              selected={false}
              accessibilityLabel={label}
            />
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    gap: 12,
  },
  slot: {
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  wasteFanContainer: {
    position: "relative",
  },
  wasteFanCard: {
    position: "absolute",
    top: 0,
  },
  recycleSymbol: {
    fontSize: 28,
    lineHeight: 32,
  },
  countText: {
    fontSize: 14,
    fontWeight: "600",
  },
});
