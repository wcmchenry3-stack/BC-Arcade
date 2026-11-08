import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import PlayingCard from "./PlayingCard";
import { computeHeartsGeometry, type TrickGeometry } from "../../game/hearts/layout";
import type { TrickCard } from "../../game/hearts/types";

interface Props {
  trick: TrickCard[];
  playerIndex: number;
  playerLabels?: string[];
  winnerIndex?: number | null;
  onAnimationComplete?: () => void;
  /** Card size, spots and sweep on the card table (#3587); a phone-sized table when omitted. */
  geometry?: TrickGeometry;
}

const DEFAULT_GEOMETRY = computeHeartsGeometry({ width: 390, height: 708 }).trick;

const POSITIONS = ["bottom", "left", "top", "right"] as const;

// All 4 cards are shown statically for SETTLE_MS before any movement begins,
// giving the completing player's card time to visibly land in its slot.
// Then cards stagger out 60 ms apart (bottom→left→top→right) over 500 ms each.
// Total window: 250 + 3 × 60 + 500 = 930 ms.
const SETTLE_MS = 250;
const STAGGER_MS = 60;
const CARD_DURATION_MS = 500;

export default function TrickArea({
  trick,
  playerIndex,
  playerLabels,
  winnerIndex,
  onAnimationComplete,
  geometry = DEFAULT_GEOMETRY,
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
  // A won trick slides to the winner's plate: each card on its own vector, so the four converge.
  const winnerPosition = shouldAnimate ? positionForSeat(winnerIndex as number) : null;

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
    const spot = geometry.slots[pos];

    let animatedStyle = null;
    if (winnerPosition && p) {
      const target = geometry.plateCentres[winnerPosition];
      const dx = target.x - (spot.x + geometry.cardW / 2);
      const dy = target.y - (spot.y + geometry.cardH / 2);
      animatedStyle = {
        transform: [
          { translateX: p.interpolate({ inputRange: [0, 1], outputRange: [0, dx] }) },
          { translateY: p.interpolate({ inputRange: [0, 1], outputRange: [0, dy] }) },
        ],
        opacity: p.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
      };
    }

    return (
      <Animated.View
        key={pos}
        style={[
          styles.slot,
          { left: spot.x, top: spot.y, width: geometry.cardW, height: geometry.cardH },
          animatedStyle,
        ]}
        accessibilityRole="image"
        accessibilityLabel={
          tc
            ? isWinner
              ? t("trick.winner", { label })
              : undefined
            : t("trick.slot.empty", { label })
        }
      >
        {tc && (
          <PlayingCard
            card={tc.card}
            highlighted={isWinner}
            width={geometry.cardW}
            height={geometry.cardH}
            rotation={spot.rotation}
          />
        )}
      </Animated.View>
    );
  }

  return (
    <View
      style={[styles.area, { width: geometry.area.w, height: geometry.area.h }]}
      accessibilityLabel={t("trick.area")}
      accessibilityRole="none"
    >
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
    position: "relative",
  },
  slot: {
    position: "absolute",
  },
  srOnly: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
    opacity: 0,
  },
});
