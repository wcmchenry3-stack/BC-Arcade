import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle } from "react-native-reanimated";
import Svg, { ClipPath, Defs, G, LinearGradient, Path, Rect, Stop } from "react-native-svg";
import { useTranslation } from "react-i18next";
import { useHeartsMoment } from "./useHeartsMoment";
import { BROKEN_TIMING, CSS_EASE_OUT, EASE_OUT, FALL_EASE, LINEAR, seg } from "./momentTimeline";
import { typography } from "../../theme/typography";
import {
  HEARTS_BROKEN_CAPTION,
  HEARTS_BROKEN_CRACK,
  HEARTS_BROKEN_EDGE,
  HEARTS_BROKEN_EDGE_OPACITY,
  HEARTS_BROKEN_HEART,
} from "../../theme/theme.hearts";

interface Props {
  visible: boolean;
  /** The trick's centre, in the overlay's coordinates: the heart pops over it. */
  centre: { x: number; y: number };
  /** The trick card width; the heart (150 at the mockup's 66) scales from it. */
  cardW: number;
  /** Where the caption's line starts: under the whole trick, so no trick card covers it. */
  captionTop: number;
  /** The overlay's size (the card table): its edges pulse red. */
  width: number;
  height: number;
  onAnimationEnd: () => void;
}

const T = BROKEN_TIMING;
const MOCK_CARD_W = 66;
const MOCK_HEART = 150;
// All in a 500-unit box. The heart, and a jagged crack from its top notch to its point.
const HEART =
  "M 250 450 C 250 450 40 310 40 180 C 40 95 110 55 180 75 C 210 84 235 105 250 130 C 265 105 290 84 320 75 C 390 55 460 95 460 180 C 460 310 250 450 250 450 Z";
const CRACK_POINTS = "L232 190 L268 240 L226 300 L262 360 L250 450";
const CRACK = `M250 130 ${CRACK_POINTS}`;
const LEFT_HALF = `M0 0 H250 ${CRACK_POINTS} L250 500 H0 Z`;
const RIGHT_HALF = `M500 0 H250 ${CRACK_POINTS} L250 500 H500 Z`;
const CRACK_TOP = 130;
const CRACK_BOTTOM = 458; // the point, plus half the stroke
const CRACK_STROKE = 14;
// The halves fall apart: out and down (fractions of the heart's size) and tilt away.
const FALL = { x: 0.12, y: 0.09, deg: 18, duration: 700 } as const;
/**
 * The red edge band, as a fraction of the shorter side, and its pulse: peaks just after the
 * "lub" (0) and the "dub" (160), so each beat lands with a flash.
 */
const EDGE_BAND = 0.2;
const EDGE_PULSE = {
  times: [0, 30, 120, 175, 700],
  values: [0, 1, 0.25, 0.85, 0],
} as const;

/**
 * Hearts broken (#3588), timed to the heartbeat: on the "lub" (0 ms) a large heart pops over
 * the trick; on the "dub" (160 ms) it beats again and a jagged crack draws through it; the two
 * halves then fall apart and fade (from 540 ms). The table's edges pulse red with the two
 * beats, and "Hearts are broken" fades in below the trick. Reduce Motion: the caption alone,
 * still, for 1 s.
 *
 * Every frame comes from the moment's UI-thread clock; the overlay never takes touches.
 */
export function HeartsBrokenAnimation({
  visible,
  centre,
  cardW,
  captionTop,
  width,
  height,
  onAnimationEnd,
}: Props) {
  const { t } = useTranslation("hearts");
  const caption = t("moments.heartsBroken");
  const { clock, stage, reduceMotion, captionShown } = useHeartsMoment({
    visible,
    end: T.end,
    reducedEnd: T.reducedEnd,
    stages: [T.dub, T.caption],
    captionStage: 2,
    announcement: caption,
    onAnimationEnd,
  });
  const k = cardW / MOCK_CARD_W;
  const size = MOCK_HEART * k;
  const unit = size / 500;
  const band = Math.min(width, height) * EDGE_BAND;

  const heartStyle = useAnimatedStyle(() => {
    const c = clock.value;
    const scale =
      c < T.dub
        ? seg(c, T.lub, 150, [0, 0.45, 1], [0.2, 1.12, 1], EASE_OUT)
        : seg(c, T.dub, 160, [0, 0.5, 1], [1, 1.08, 1], CSS_EASE_OUT);
    const opacity =
      c < T.split + 150
        ? seg(c, T.lub, 150, [0, 0.45, 1], [0, 0.95, 0.95], EASE_OUT)
        : seg(c, T.split + 150, 700, [0, 1], [0.95, 0], EASE_OUT);
    return { opacity, transform: [{ scale }] };
  });
  const leftStyle = useAnimatedStyle(() => halfFrame(clock.value, -1, size));
  const rightStyle = useAnimatedStyle(() => halfFrame(clock.value, 1, size));
  // The crack draws top to bottom: a window over it slides down into place while the crack
  // inside slides the other way, so only its drawn part shows. Transforms only, no layout.
  const crackLength = (CRACK_BOTTOM - CRACK_TOP) * unit;
  const crackStyle = useAnimatedStyle(() => {
    const c = clock.value;
    const hidden = (1 - seg(c, T.dub, 140, [0, 1], [0, 1], LINEAR)) * crackLength;
    return {
      opacity: seg(c, T.split, 200, [0, 1], [1, 0], LINEAR),
      transform: [{ translateY: -hidden }],
    };
  });
  const crackInnerStyle = useAnimatedStyle(() => {
    const hidden = (1 - seg(clock.value, T.dub, 140, [0, 1], [0, 1], LINEAR)) * crackLength;
    return { transform: [{ translateY: hidden }] };
  });
  const edgeStyle = useAnimatedStyle(() => {
    const c = clock.value;
    let opacity = 0;
    const { times, values } = EDGE_PULSE;
    for (let i = 1; i < times.length; i++) {
      if (c <= times[i]!) {
        const span = times[i]! - times[i - 1]!;
        opacity = seg(c, times[i - 1]!, span, [0, 1], [values[i - 1]!, values[i]!], LINEAR);
        break;
      }
    }
    return { opacity };
  });
  const captionStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1 };
    return {
      opacity: seg(clock.value, T.caption, 1500, [0, 0.2, 0.8, 1], [0, 1, 1, 0], EASE_OUT),
    };
  });

  if (!visible) return null;
  const heartBox = {
    left: centre.x - size / 2,
    top: centre.y - size / 2,
    width: size,
    height: size,
  };
  return (
    <View testID="hearts-broken-moment" style={StyleSheet.absoluteFill} pointerEvents="none">
      {!reduceMotion && (
        <>
          <Animated.View testID="hearts-broken-edges" style={[StyleSheet.absoluteFill, edgeStyle]}>
            <Svg width={width} height={height}>
              <Defs>
                {(["top", "bottom", "left", "right"] as const).map((side) => (
                  <LinearGradient
                    key={side}
                    id={`heartsBrokenEdge-${side}`}
                    x1={side === "left" ? 0 : side === "right" ? 1 : 0}
                    y1={side === "top" ? 0 : side === "bottom" ? 1 : 0}
                    x2={side === "left" ? 1 : side === "right" ? 0 : 0}
                    y2={side === "top" ? 1 : side === "bottom" ? 0 : 0}
                  >
                    <Stop
                      offset="0"
                      stopColor={HEARTS_BROKEN_EDGE}
                      stopOpacity={HEARTS_BROKEN_EDGE_OPACITY}
                    />
                    <Stop
                      offset="0.35"
                      stopColor={HEARTS_BROKEN_EDGE}
                      stopOpacity={HEARTS_BROKEN_EDGE_OPACITY * 0.45}
                    />
                    <Stop offset="1" stopColor={HEARTS_BROKEN_EDGE} stopOpacity={0} />
                  </LinearGradient>
                ))}
              </Defs>
              <Rect x={0} y={0} width={width} height={band} fill="url(#heartsBrokenEdge-top)" />
              <Rect
                x={0}
                y={height - band}
                width={width}
                height={band}
                fill="url(#heartsBrokenEdge-bottom)"
              />
              <Rect x={0} y={0} width={band} height={height} fill="url(#heartsBrokenEdge-left)" />
              <Rect
                x={width - band}
                y={0}
                width={band}
                height={height}
                fill="url(#heartsBrokenEdge-right)"
              />
            </Svg>
          </Animated.View>
          <Animated.View testID="hearts-broken-heart" style={[styles.abs, heartBox, heartStyle]}>
            <Animated.View style={[StyleSheet.absoluteFill, leftStyle]}>
              <HeartHalf id="heartsBrokenLeft" clip={LEFT_HALF} size={size} />
            </Animated.View>
            <Animated.View style={[StyleSheet.absoluteFill, rightStyle]}>
              <HeartHalf id="heartsBrokenRight" clip={RIGHT_HALF} size={size} />
            </Animated.View>
            {stage >= 1 && (
              // Drawn top to bottom: a window over the crack that grows with the dub.
              <Animated.View
                testID="hearts-broken-crack"
                style={[
                  styles.crackWindow,
                  { top: CRACK_TOP * unit, width: size, height: crackLength },
                  crackStyle,
                ]}
              >
                <Animated.View style={crackInnerStyle}>
                  <Svg
                    width={size}
                    height={size}
                    viewBox="0 0 500 500"
                    style={{ marginTop: -CRACK_TOP * unit }}
                  >
                    <Path
                      d={CRACK}
                      fill="none"
                      stroke={HEARTS_BROKEN_CRACK}
                      strokeWidth={CRACK_STROKE}
                      strokeLinejoin="round"
                    />
                  </Svg>
                </Animated.View>
              </Animated.View>
            )}
          </Animated.View>
        </>
      )}
      <View
        style={[styles.captionBox, { top: captionTop }]}
        accessibilityLiveRegion={Platform.OS === "ios" ? undefined : "polite"}
      >
        {captionShown && (
          <Animated.Text style={[styles.caption, captionStyle]}>{caption}</Animated.Text>
        )}
      </View>
    </View>
  );
}

/** One half of the heart: the whole heart, clipped along the crack. */
function HeartHalf({ id, clip, size }: { id: string; clip: string; size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 500 500">
      <Defs>
        <ClipPath id={id}>
          <Path d={clip} />
        </ClipPath>
      </Defs>
      <G clipPath={`url(#${id})`}>
        <Path d={HEART} fill={HEARTS_BROKEN_HEART} />
      </G>
    </Svg>
  );
}

/** A half falling away from 540 ms: `side` -1 is the left half, 1 the right. */
function halfFrame(c: number, side: number, size: number) {
  "worklet";
  const p = seg(c, BROKEN_TIMING.split, FALL.duration, [0, 1], [0, 1], FALL_EASE);
  return {
    transform: [
      { translateX: side * FALL.x * size * p },
      { translateY: FALL.y * size * p },
      { rotate: `${side * FALL.deg * p}deg` },
    ],
  };
}

const styles = StyleSheet.create({
  abs: {
    position: "absolute",
  },
  crackWindow: {
    position: "absolute",
    left: 0,
    overflow: "hidden",
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
    color: HEARTS_BROKEN_CAPTION,
    textAlign: "center",
    paddingHorizontal: 16,
  },
});
