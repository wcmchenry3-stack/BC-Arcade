import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import PlayingCard from "./PlayingCard";
import type { TrickCard } from "../../game/hearts/types";

interface Props {
  trick: TrickCard[];
  playerIndex: number;
  playerLabels?: string[];
  winnerIndex?: number | null;
  onAnimationComplete?: () => void;
}

const POSITIONS = ["bottom", "left", "top", "right"] as const;

// All 4 cards are shown statically for SETTLE_MS before any movement begins,
// giving the completing player's card time to visibly land in its slot.
// Then cards stagger out 60 ms apart (bottom→left→top→right) over 500 ms each.
// Total window: 250 + 3 × 60 + 500 = 930 ms.
const SETTLE_MS = 250;
const STAGGER_MS = 60;
const CARD_DURATION_MS = 500;

// Direction vector per winner screen-position (relative to human). Cards slide
// from the trick area toward the winning seat, matching the design spec.
const DIRECTION_OFFSET: Record<(typeof POSITIONS)[number], { x: number; y: number }> = {
  bottom: { x: 0, y: 120 },
  left: { x: -140, y: 0 },
  top: { x: 0, y: -120 },
  right: { x: 140, y: 0 },
};

export default function TrickArea({
  trick,
  playerIndex,
  playerLabels,
  winnerIndex,
  onAnimationComplete,
}: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();

  // One Animated.Value per position slot (bottom=0, left=1, top=2, right=3).
  const cardProgress = useRef(
    POSITIONS.map(() => new Animated.Value(0)) as [
      Animated.Value,
      Animated.Value,
      Animated.Value,
      Animated.Value,
    ]
  ).current;

  const onCompleteRef = useRef(onAnimationComplete);
  onCompleteRef.current = onAnimationComplete;

  // Map seat index (0-3) to compass position relative to human player
  function positionForSeat(seat: number): (typeof POSITIONS)[number] {
    const offset = (seat - playerIndex + 4) % 4;
    return POSITIONS[offset] ?? "bottom";
  }

  const hasWinner = winnerIndex !== null && winnerIndex !== undefined;
  const shouldAnimate = hasWinner && trick.length === 4;
  const winnerDirection = shouldAnimate
    ? DIRECTION_OFFSET[positionForSeat(winnerIndex as number)]
    : null;

  useEffect(() => {
    if (!shouldAnimate) {
      cardProgress.forEach((p) => p.setValue(0));
      return;
    }
    cardProgress.forEach((p) => p.setValue(0));

    const animations = cardProgress.map((p, i) =>
      Animated.sequence([
        Animated.delay(SETTLE_MS + i * STAGGER_MS),
        Animated.timing(p, {
          toValue: 1,
          duration: CARD_DURATION_MS,
          easing: Easing.in(Easing.ease),
          useNativeDriver: false,
        }),
      ])
    );
    const group = Animated.parallel(animations);
    group.start(({ finished }) => {
      if (finished) onCompleteRef.current?.();
    });
    return () => {
      group.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shouldAnimate, winnerIndex]);

  const slots: Record<string, TrickCard | undefined> = {};
  for (const tc of trick) {
    slots[positionForSeat(tc.playerIndex)] = tc;
  }

  function renderSlot(pos: (typeof POSITIONS)[number], seatIndex: number) {
    const tc = slots[pos];
    const label = playerLabels?.[seatIndex] ?? String(seatIndex);
    const isWinner = hasWinner && winnerIndex === seatIndex;
    const p = cardProgress[POSITIONS.indexOf(pos)];

    const animatedStyle =
      winnerDirection && p
        ? {
            transform: [
              {
                translateX: p.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, winnerDirection.x],
                }),
              },
              {
                translateY: p.interpolate({
                  inputRange: [0, 1],
                  outputRange: [0, winnerDirection.y],
                }),
              },
            ],
            opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
          }
        : null;

    return (
      <Animated.View
        key={pos}
        style={[styles.slot, styles[pos], animatedStyle]}
        accessibilityLabel={
          tc
            ? isWinner
              ? t("trick.winner", { label })
              : undefined
            : t("trick.slot.empty", { label })
        }
      >
        {tc ? (
          <PlayingCard card={tc.card} highlighted={isWinner} />
        ) : (
          <View
            style={[
              styles.emptySlot,
              { borderColor: colors.border, backgroundColor: "transparent" },
            ]}
          />
        )}
      </Animated.View>
    );
  }

  return (
    <View style={styles.area} accessibilityLabel={t("trick.area")} accessibilityRole="none">
      <Text style={[styles.srOnly, { color: colors.text }]}>{t("trick.area")}</Text>
      {([0, 1, 2, 3] as const).map((offset) => {
        const seat = (playerIndex + offset) % 4;
        const pos = POSITIONS[offset] ?? "bottom";
        return renderSlot(pos, seat);
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  area: {
    width: 200,
    height: 200,
    position: "relative",
  },
  slot: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  bottom: {
    bottom: 0,
    left: "50%",
    marginLeft: -30,
  },
  top: {
    top: 0,
    left: "50%",
    marginLeft: -30,
  },
  left: {
    left: 0,
    top: "50%",
    marginTop: -37,
  },
  right: {
    right: 0,
    top: "50%",
    marginTop: -37,
  },
  emptySlot: {
    width: 52,
    height: 74,
    borderRadius: 8,
    borderWidth: 1,
    borderStyle: "dashed",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
