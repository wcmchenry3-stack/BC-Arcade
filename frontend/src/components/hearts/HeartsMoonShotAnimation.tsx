import React from "react";
import { Platform, StyleSheet, View } from "react-native";
import Animated, { useAnimatedStyle, type SharedValue } from "react-native-reanimated";
import Svg, {
  Circle,
  Defs,
  LinearGradient,
  Path,
  RadialGradient,
  Rect,
  Stop,
} from "react-native-svg";
import { useTranslation } from "react-i18next";
import { useHeartsMoment } from "./useHeartsMoment";
import { EASE_OUT, LINEAR, MOON_TIMING, seg } from "./momentTimeline";
import { typography } from "../../theme/typography";
import {
  HEARTS_MOON_GLOW,
  HEARTS_MOON_LIGHT,
  HEARTS_MOON_MID,
  HEARTS_MOON_PENALTY,
  HEARTS_MOON_RIM,
  HEARTS_MOON_SILHOUETTE,
  HEARTS_MOON_SKY_BOTTOM,
  HEARTS_MOON_SKY_MID,
  HEARTS_MOON_SKY_TOP,
  HEARTS_MOON_STAR,
  HEARTS_MOON_TITLE,
  HEARTS_MOON_TITLE_GLOW,
} from "../../theme/theme.hearts";

interface Props {
  visible: boolean;
  /** The shooter's name, and whether it is the human ("You shot the moon!"). */
  shooterLabel: string;
  shooterIsHuman: boolean;
  /** The three other players' names, in seat order: each takes 26. */
  otherLabels: readonly [string, string, string];
  /** The overlay's size (the card table). */
  width: number;
  height: number;
  onAnimationEnd: () => void;
}

const T = MOON_TIMING;
// The mockup's table: 390 × 708 (its phone less the 64 px header). Positions are mapped from it.
const MOCK_W = 390;
const MOCK_H = 708;
const MOCK_TOP = 64;
const STAR_COUNT = 28;
/** The stars twinkle in seven staggered groups: one animated parent each. */
const STAR_BUCKETS = 7;
const MOON = { size: 200, top: 560, rise: 330, delay: 150, duration: 1400 } as const;
const HILL = { top: 520, height: 260, drop: 80, delay: 100, duration: 900 } as const;
// The hill, in a 390 × 260 box; the wolves sit on it (their own 200 × 200 box, placed and
// scaled in the hill's units). Original silhouettes drawn for BC Arcade.
const HILL_PATH = "M0 120 Q120 40 260 90 Q330 115 390 100 L390 260 L0 260 Z";
const WOLF_PATH =
  "M40 200 C20 190 6 160 16 136 C22 150 34 156 52 150 C58 130 66 116 80 106 C86 92 90 80 96 68 L98 40 L108 56 C114 52 120 50 124 48 L150 20 L158 18 L156 28 L132 60 C128 70 124 80 124 92 C128 120 130 160 132 200 L118 200 L112 160 C100 164 92 164 84 160 L82 200 Z";
const WOLVES = [
  { x: 112, y: -98, scale: 0.95, at: T.wolf },
  { x: 300, y: 28, scale: 0.42, at: T.answer },
] as const;
/** The moon's soft glow: how far it spreads past the rim (mockup px) and how bright it starts. */
const MOON_GLOW = { spread: 70, opacity: 0.4 } as const;

/**
 * The moon shot (#3588). The board fades to a night sky with twinkling stars, a full moon
 * rises behind a dark hill, a wolf appears on the hill with the first howl and a smaller,
 * farther one with the answer (+1.45 s), and "You shot the moon!" / "+26 to …" fade in. At
 * 3.3 s the scene fades; `onAnimationEnd` (which lets Hand Complete open, #3586) fires at
 * 3.7 s. Reduce Motion: the finished scene, still, for 1.2 s.
 *
 * Every frame comes from the moment's UI-thread clock; the overlay never takes touches.
 */
export function HeartsMoonShotAnimation({
  visible,
  shooterLabel,
  shooterIsHuman,
  otherLabels,
  width,
  height,
  onAnimationEnd,
}: Props) {
  const { t } = useTranslation("hearts");
  const title = shooterIsHuman
    ? t("moments.moonShotYou")
    : t("events.moonShot", { name: shooterLabel });
  const [a, b, c] = otherLabels;
  const penalty = t("moments.moonPenalty", { a, b, c });
  const { clock, stage, reduceMotion, captionShown } = useHeartsMoment({
    visible,
    end: T.end,
    reducedEnd: T.reducedEnd,
    stages: [T.wolf, T.title, T.answer],
    captionStage: 2,
    announcement: `${title} ${penalty}`,
    onAnimationEnd,
  });
  const s = Math.min(width / MOCK_W, height / MOCK_H);
  const sx = width / MOCK_W;
  const y = (v: number) => ((v - MOCK_TOP) / MOCK_H) * height;
  const moonSize = MOON.size * s;
  const rise = (MOON.rise / MOCK_H) * height;

  const sceneStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : seg(clock.value, T.fade, 400, [0, 1], [1, 0], EASE_OUT),
  }));
  const skyStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 0.96 : seg(clock.value, 0, 600, [0, 1], [0, 0.96], EASE_OUT),
  }));
  const moonStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: reduceMotion
          ? -rise
          : seg(clock.value, MOON.delay, MOON.duration, [0, 1], [0, -rise], EASE_OUT),
      },
    ],
  }));
  const hillStyle = useAnimatedStyle(() => ({
    transform: [
      {
        translateY: reduceMotion
          ? 0
          : seg(clock.value, HILL.delay, HILL.duration, [0, 1], [HILL.drop * s, 0], EASE_OUT),
      },
    ],
  }));
  const wolf0 = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : seg(clock.value, WOLVES[0].at, 300, [0, 1], [0, 1], LINEAR),
  }));
  const wolf1 = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : seg(clock.value, WOLVES[1].at, 300, [0, 1], [0, 1], LINEAR),
  }));
  const titleStyle = useAnimatedStyle(() => {
    if (reduceMotion) return { opacity: 1 };
    const c = clock.value;
    return {
      opacity: seg(c, T.title, 500, [0, 1], [0, 1], EASE_OUT),
      transform: [{ translateY: seg(c, T.title, 500, [0, 1], [10, 0], EASE_OUT) }],
    };
  });
  const penaltyStyle = useAnimatedStyle(() => ({
    opacity: reduceMotion ? 1 : seg(clock.value, T.penalty, 400, [0, 1], [0, 1], EASE_OUT),
  }));

  if (!visible) return null;
  const hillTop = y(HILL.top);
  const hillH = HILL.height * s;
  const wolfStyles = [wolf0, wolf1];
  // Reduce Motion shows the finished scene at once.
  const reached = (n: number) => reduceMotion || stage >= n;
  return (
    <Animated.View
      testID="hearts-moon-moment"
      style={[StyleSheet.absoluteFill, styles.scene, sceneStyle]}
      pointerEvents="none"
    >
      <Animated.View style={[StyleSheet.absoluteFill, skyStyle]}>
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id="heartsMoonSky" x1={0} y1={0} x2={0} y2={1}>
              <Stop offset="0" stopColor={HEARTS_MOON_SKY_TOP} />
              <Stop offset="0.55" stopColor={HEARTS_MOON_SKY_MID} />
              <Stop offset="1" stopColor={HEARTS_MOON_SKY_BOTTOM} />
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill="url(#heartsMoonSky)" />
        </Svg>
      </Animated.View>
      {Array.from({ length: STAR_BUCKETS }, (_, b) => (
        <StarBucket
          key={b}
          bucket={b}
          clock={clock}
          still={reduceMotion}
          stars={Array.from({ length: STAR_COUNT }, (_, i) => i)
            .filter((i) => i % STAR_BUCKETS === b)
            .map((i) => ({ left: (((i * 137) % 380) + 5) * sx, top: y(((i * 89) % 420) + 70) }))}
        />
      ))}
      <Animated.View
        testID="hearts-moon-moon"
        style={[
          styles.abs,
          {
            left: width / 2 - moonSize / 2,
            top: y(MOON.top),
            width: moonSize,
            height: moonSize,
          },
          moonStyle,
        ]}
      >
        <Svg
          width={moonSize + 2 * MOON_GLOW.spread * s}
          height={moonSize + 2 * MOON_GLOW.spread * s}
          viewBox={`0 0 ${200 + 2 * MOON_GLOW.spread} ${200 + 2 * MOON_GLOW.spread}`}
          style={[styles.glow, { left: -MOON_GLOW.spread * s, top: -MOON_GLOW.spread * s }]}
        >
          <Defs>
            <RadialGradient id="heartsMoonGlow" cx="0.5" cy="0.5" r="0.5">
              <Stop
                offset={100 / (100 + MOON_GLOW.spread)}
                stopColor={HEARTS_MOON_GLOW}
                stopOpacity={MOON_GLOW.opacity}
              />
              <Stop offset="1" stopColor={HEARTS_MOON_GLOW} stopOpacity={0} />
            </RadialGradient>
          </Defs>
          <Circle
            cx={100 + MOON_GLOW.spread}
            cy={100 + MOON_GLOW.spread}
            r={100 + MOON_GLOW.spread}
            fill="url(#heartsMoonGlow)"
          />
        </Svg>
        <Svg width={moonSize} height={moonSize} viewBox="0 0 200 200">
          <Defs>
            <RadialGradient id="heartsMoonFace" cx="0.38" cy="0.35" r="0.9" fx="0.38" fy="0.35">
              <Stop offset="0" stopColor={HEARTS_MOON_LIGHT} />
              <Stop offset="0.55" stopColor={HEARTS_MOON_MID} />
              <Stop offset="1" stopColor={HEARTS_MOON_RIM} />
            </RadialGradient>
          </Defs>
          <Circle cx={100} cy={100} r={100} fill="url(#heartsMoonFace)" />
        </Svg>
      </Animated.View>
      <Animated.View
        testID="hearts-moon-hill"
        style={[styles.abs, { left: 0, top: hillTop, width, height: hillH }, hillStyle]}
      >
        <Svg width={width} height={hillH} viewBox="0 0 390 260" preserveAspectRatio="none">
          <Path d={HILL_PATH} fill={HEARTS_MOON_SILHOUETTE} />
        </Svg>
        {WOLVES.map((wolf, i) =>
          reached(i === 0 ? 1 : 3) ? (
            <Animated.View
              key={i}
              testID={`hearts-moon-wolf-${i}`}
              style={[
                styles.abs,
                {
                  left: wolf.x * sx,
                  top: wolf.y * s,
                  width: 200 * wolf.scale * s,
                  height: 200 * wolf.scale * s,
                },
                wolfStyles[i],
              ]}
            >
              <Svg width="100%" height="100%" viewBox="0 0 200 200">
                <Path d={WOLF_PATH} fill={HEARTS_MOON_SILHOUETTE} />
              </Svg>
            </Animated.View>
          ) : null
        )}
      </Animated.View>
      {/* The live region is there from the start, so Android reads the captions when they appear. */}
      <View
        style={[styles.captions, { top: y(150) }]}
        accessibilityLiveRegion={Platform.OS === "ios" ? undefined : "polite"}
      >
        {captionShown && (
          <View accessible accessibilityLabel={`${title} ${penalty}`} style={styles.captionGroup}>
            <Animated.Text style={[styles.title, titleStyle]}>{title}</Animated.Text>
            <Animated.Text style={[styles.penalty, penaltyStyle]}>{penalty}</Animated.Text>
          </View>
        )}
      </View>
    </Animated.View>
  );
}

interface StarBucketProps {
  bucket: number;
  clock: SharedValue<number>;
  still: boolean;
  stars: readonly { left: number; top: number }[];
}

/**
 * One group of stars twinkling together: in from 300 ms plus 120 ms per group, bright, dim,
 * bright. The stars themselves are static; only the group's opacity moves.
 */
function StarBucket({ bucket, clock, still, stars }: StarBucketProps) {
  const start = 300 + bucket * 120;
  const style = useAnimatedStyle(() => ({
    opacity: still
      ? 0.9
      : seg(clock.value, start, 2400, [0, 1 / 3, 2 / 3, 1], [0, 0.9, 0.3, 0.9], EASE_OUT),
  }));
  return (
    <Animated.View style={[StyleSheet.absoluteFill, style]}>
      {stars.map(({ left, top }) => (
        <View key={`${left}-${top}`} style={[styles.star, { left, top }]} />
      ))}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  scene: {
    overflow: "hidden",
  },
  abs: {
    position: "absolute",
  },
  glow: {
    position: "absolute",
  },
  star: {
    position: "absolute",
    width: 2,
    height: 2,
    borderRadius: 1,
    backgroundColor: HEARTS_MOON_STAR,
  },
  captions: {
    position: "absolute",
    left: 0,
    right: 0,
    alignItems: "center",
  },
  captionGroup: {
    alignItems: "center",
    paddingHorizontal: 16,
  },
  title: {
    fontFamily: typography.heading,
    fontSize: 30,
    color: HEARTS_MOON_TITLE,
    textAlign: "center",
    textShadowColor: HEARTS_MOON_TITLE_GLOW,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 18,
  },
  penalty: {
    marginTop: 8,
    fontFamily: typography.label,
    fontSize: 15,
    color: HEARTS_MOON_PENALTY,
    textAlign: "center",
  },
});
