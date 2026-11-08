import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { Defs, RadialGradient, Rect, Stop } from "react-native-svg";
import { useTranslation } from "react-i18next";
import PlayingCard from "./PlayingCard";
import { useHeartsMoment } from "./useHeartsMoment";
import { EASE_OUT, QUEEN_TIMING, RING_EASE, seg } from "./momentTimeline";
import { typography } from "../../theme/typography";
import {
  HEARTS_QUEEN_CAPTION,
  HEARTS_QUEEN_GLOW,
  HEARTS_QUEEN_SCRIM_CENTRE,
  HEARTS_QUEEN_SCRIM_EDGE,
  HEARTS_QUEEN_SCRIM_EDGE_OPACITY,
} from "../../theme/theme.hearts";
import type { Card } from "../../game/hearts/types";

/** Where the Q♠ lies in the trick, in the overlay's coordinates (its unrotated box). */
export interface QueenCardRect {
  x: number;
  y: number;
  w: number;
  h: number;
  /** The trick slot's tilt, in degrees. */
  rotation: number;
}

interface Props {
  visible: boolean;
  /** The Q♠ in the trick; the moment lifts a copy of it from here. */
  card: QueenCardRect;
  /** Where the caption's line starts: under the whole trick, so no trick card covers it. */
  captionTop: number;
  /** The overlay's size (the card table). */
  width: number;
  height: number;
  onAnimationEnd: () => void;
}

const QUEEN: Card = { suit: "spades", rank: 12 };
const T = QUEEN_TIMING;
const { strike: S, settle: R } = T;
/** The mockup's trick card width; the rings, glow and caption gap scale from it. */
const MOCK_CARD_W = 66;
// Lift: 1 → 1.32 at 30 % of 900 ms, settling at 1.22; back to 1 over 350 ms from the settle.
const LIFT = { duration: 900, offsets: [0, 0.3, 1], back: 350 } as const;
// Glow: three soft layers around the lifted card (spread in mockup px, opacity).
const GLOW_LAYERS = [
  [3, 0.55],
  [8, 0.3],
  [15, 0.14],
] as const;

/**
 * The Queen of Spades moment (#3588). When the Q♠ lands, at the gong's strike (230 ms after it
 * is played): a purple-dark radial scrim fades in, the Q♠ lifts to 1.32× with a magenta glow
 * and settles at 1.22×, two gong rings spread from it 260 ms apart, and the caption reads
 * "The Queen of Spades · 13 points". The trick's other cards nudge outward once (`TrickArea`'s
 * `nudge`). It holds 1.7 s from the strike, then everything returns. Reduce Motion: the scrim
 * and the caption, still, for 1.2 s.
 *
 * Every frame comes from the moment's UI-thread clock; the overlay never takes touches.
 */
export function HeartsQueenOfSpadesAnimation({
  visible,
  card,
  captionTop,
  width,
  height,
  onAnimationEnd,
}: Props) {
  const { t } = useTranslation("hearts");
  const caption = t("moments.queenOfSpades");
  const { clock, stage, reduceMotion } = useHeartsMoment({
    visible,
    end: T.end,
    reducedEnd: T.reducedEnd,
    stages: [S, T.caption],
    captionStage: 2,
    announcement: caption,
    onAnimationEnd,
  });
  const k = card.w / MOCK_CARD_W;
  const cx = card.x + card.w / 2;
  const cy = card.y + card.h / 2;

  const scrimStyle = useAnimatedStyle(() => {
    const c = clock.value;
    if (reduceMotion) return { opacity: 0.85 };
    return {
      opacity:
        c < R
          ? seg(c, S, 1300, [0, 0.25, 1], [0, 1, 0.85], EASE_OUT)
          : seg(c, R, 400, [0, 1], [0.85, 0], EASE_OUT),
    };
  });
  const cardStyle = useAnimatedStyle(() => {
    const c = clock.value;
    const up = c < R;
    const scale = up
      ? seg(c, S, LIFT.duration, LIFT.offsets, [1, 1.32, 1.22], EASE_OUT)
      : seg(c, R, LIFT.back, [0, 1], [1.22, 1], EASE_OUT);
    const rotation = up
      ? seg(c, S, LIFT.duration, LIFT.offsets, [card.rotation, 0, 0], EASE_OUT)
      : seg(c, R, LIFT.back, [0, 1], [0, card.rotation], EASE_OUT);
    return {
      // The copy sits exactly on the real card, so it can appear and vanish without a jump.
      opacity: c >= S && c < R + LIFT.back ? 1 : 0,
      transform: [{ rotate: `${rotation}deg` }, { scale }],
    };
  });
  const glowStyle = useAnimatedStyle(() => {
    const c = clock.value;
    return {
      opacity:
        c < R
          ? seg(c, S, LIFT.duration, LIFT.offsets, [0, 0.85, 0.6], EASE_OUT)
          : seg(c, R, LIFT.back, [0, 1], [0.6, 0], EASE_OUT),
    };
  });
  const ring0 = useAnimatedStyle(() => ringFrame(clock.value, S));
  const ring1 = useAnimatedStyle(() => ringFrame(clock.value, S + T.ringGap));
  const captionStyle = useAnimatedStyle(() => {
    const c = clock.value;
    if (reduceMotion) return { opacity: 1 };
    return {
      opacity:
        c < R
          ? seg(c, T.caption, 300, [0, 1], [0, 1], EASE_OUT)
          : seg(c, R, 300, [0, 1], [1, 0], EASE_OUT),
      transform: [{ translateY: seg(c, T.caption, 300, [0, 1], [6, 0], EASE_OUT) }],
    };
  });

  if (!visible) return null;
  const ring = 80 * k;
  const showCaption = reduceMotion || stage >= 2;
  return (
    <View testID="hearts-queen-moment" style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View
        testID="hearts-queen-scrim"
        style={[StyleSheet.absoluteFill, scrimStyle]}
        pointerEvents="none"
      >
        <Svg width={width} height={height}>
          <Defs>
            <RadialGradient
              id="heartsQueenScrim"
              cx={width / 2}
              cy={height * 0.4}
              r={Math.hypot(width / 2, height * 0.6)}
              gradientUnits="userSpaceOnUse"
            >
              <Stop offset="0" stopColor={HEARTS_QUEEN_SCRIM_CENTRE} stopOpacity={0} />
              <Stop
                offset="1"
                stopColor={HEARTS_QUEEN_SCRIM_EDGE}
                stopOpacity={HEARTS_QUEEN_SCRIM_EDGE_OPACITY}
              />
            </RadialGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#heartsQueenScrim)" />
        </Svg>
      </Animated.View>
      {!reduceMotion && (
        <Animated.View
          testID="hearts-queen-card"
          style={[
            styles.card,
            { left: card.x, top: card.y, width: card.w, height: card.h },
            cardStyle,
          ]}
          // A copy of the trick's Q♠: screen readers already have the real one.
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          <Animated.View style={[StyleSheet.absoluteFill, glowStyle]}>
            {GLOW_LAYERS.map(([spread, opacity]) => (
              <View
                key={spread}
                style={[
                  styles.glow,
                  {
                    left: -spread * k,
                    top: -spread * k,
                    right: -spread * k,
                    bottom: -spread * k,
                    borderRadius: (6 + spread) * k,
                    opacity,
                  },
                ]}
              />
            ))}
          </Animated.View>
          <PlayingCard card={QUEEN} width={card.w} height={card.h} />
        </Animated.View>
      )}
      {!reduceMotion && stage >= 1 && (
        <>
          {[ring0, ring1].map((style, i) => (
            <Animated.View
              key={i}
              testID={`hearts-queen-ring-${i}`}
              style={[
                styles.ring,
                {
                  left: cx - ring / 2,
                  top: cy - ring / 2,
                  width: ring,
                  height: ring,
                  borderRadius: ring / 2,
                  borderWidth: 3 * k,
                },
                style,
              ]}
            />
          ))}
        </>
      )}
      {/* The live region is there from the start, so Android reads the caption when it appears. */}
      <View
        style={[styles.captionBox, { top: captionTop }]}
        accessibilityLiveRegion={Platform.OS === "ios" ? undefined : "polite"}
      >
        {showCaption && (
          <Animated.Text style={[styles.caption, captionStyle]}>{caption}</Animated.Text>
        )}
      </View>
    </View>
  );
}

/** A gong ring: 0.6× → 4.2× while it fades, over 1.1 s from `start`. */
function ringFrame(c: number, start: number) {
  "worklet";
  if (c < start) return { opacity: 0, transform: [{ scale: 0.6 }] };
  return {
    opacity: 0.9 * seg(c, start, QUEEN_TIMING.ringDuration, [0, 1], [1, 0], RING_EASE),
    transform: [{ scale: seg(c, start, QUEEN_TIMING.ringDuration, [0, 1], [0.6, 4.2], RING_EASE) }],
  };
}

const styles = StyleSheet.create({
  ring: {
    position: "absolute",
    borderColor: HEARTS_QUEEN_GLOW,
  },
  card: {
    position: "absolute",
  },
  glow: {
    position: "absolute",
    backgroundColor: HEARTS_QUEEN_GLOW,
  },
  captionBox: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  caption: {
    fontFamily: typography.label,
    fontSize: 15,
    letterSpacing: 0.6,
    color: HEARTS_QUEEN_CAPTION,
    textAlign: "center",
    paddingHorizontal: 16,
  },
});
