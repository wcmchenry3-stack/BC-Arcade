import React, { useEffect, useRef } from "react";
import { View, Text, StyleSheet, Animated, Easing } from "react-native";
import Reanimated, {
  cancelAnimation,
  Easing as ReEasing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withTiming,
} from "react-native-reanimated";
import { useTranslation } from "react-i18next";
import { useTheme } from "../../theme/ThemeContext";
import PlayingCard from "./PlayingCard";
import { EASE_OUT, QUEEN_TIMING, seg } from "./momentTimeline";
import { useReduceMotion } from "../shared/useReduceMotion";
import { isQueenOfSpades } from "../../game/hearts/engine";
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
  /**
   * While true a completed trick stays on the table instead of sweeping; the sweep starts
   * when it turns false. The Queen of Spades moment holds it (#3588).
   */
  holdSweep?: boolean;
  /** The Queen of Spades moment (#3588): the trick's other cards nudge outward once. */
  nudge?: boolean;
}

/** How far the other trick cards nudge outward for the Queen of Spades, at the mockup's 66 dp. */
const NUDGE_DISTANCE = 8;
const MOCK_CARD_W = 66;
/** Outward, from the trick's centre, for each slot. */
const OUTWARD = {
  bottom: [0, 1],
  left: [-1, 0],
  top: [0, -1],
  right: [1, 0],
} as const;

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
  holdSweep = false,
  nudge = false,
}: Props) {
  const { t } = useTranslation("hearts");
  const { colors } = useTheme();
  const reduceMotion = useReduceMotion();

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
  const shouldAnimate = hasWinner && trick.length === 4 && !holdSweep;
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
          <NudgeOutward
            active={nudge && !reduceMotion && !isQueenOfSpades(tc.card)}
            dx={OUTWARD[pos][0] * NUDGE_DISTANCE * (geometry.cardW / MOCK_CARD_W)}
            dy={OUTWARD[pos][1] * NUDGE_DISTANCE * (geometry.cardW / MOCK_CARD_W)}
          >
            <PlayingCard
              card={tc.card}
              highlighted={isWinner}
              width={geometry.cardW}
              height={geometry.cardH}
              rotation={spot.rotation}
            />
          </NudgeOutward>
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

interface NudgeProps {
  active: boolean;
  dx: number;
  dy: number;
  children: React.ReactNode;
}

/**
 * One outward nudge and back, on the UI thread, when `active` turns true: timed to the Queen
 * of Spades' gong strike (`QUEEN_TIMING.nudgeAt`, 500 ms).
 */
function NudgeOutward({ active, dx, dy, children }: NudgeProps) {
  const progress = useSharedValue(0);
  useEffect(() => {
    cancelAnimation(progress);
    progress.value = 0;
    if (!active) return;
    progress.value = withDelay(
      QUEEN_TIMING.nudgeAt,
      withTiming(1, { duration: QUEEN_TIMING.nudgeDuration, easing: ReEasing.linear })
    );
    return () => cancelAnimation(progress);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
  const style = useAnimatedStyle(() => {
    const k = seg(progress.value, 0, 1, [0, 0.5, 1], [0, 1, 0], EASE_OUT);
    return { transform: [{ translateX: dx * k }, { translateY: dy * k }] };
  });
  return <Reanimated.View style={style}>{children}</Reanimated.View>;
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
