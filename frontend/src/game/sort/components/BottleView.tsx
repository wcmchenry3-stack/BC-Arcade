import React, { useEffect } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import Animated, {
  cancelAnimation,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import Svg, {
  Circle,
  ClipPath,
  Defs,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { Bottle, Color } from "../types";
import { BOTTLE_DEPTH } from "../types";
import { isBottleSolved } from "../engine";
import {
  BOTTLE_LIQUID_COLORS,
  BOTTLE_STROKE_SELECTED,
  BOTTLE_STROKE_SOLVED,
  BOTTLE_STROKE_DEFAULT,
  BOTTLE_BODY_FILL_SELECTED,
  BOTTLE_BODY_FILL_DEFAULT,
  BOTTLE_GLOSS_HIGHLIGHT,
  BOTTLE_GLOSS_SHADOW,
  BOTTLE_LIQUID_GLOSS_FILL,
  BOTTLE_CHECKMARK_BG,
  BOTTLE_CHECKMARK_STROKE,
  BOTTLE_COLORBLIND_TEXT,
} from "../../../theme/theme.bottle";

// SVG design dimensions — the viewBox stays fixed; width/height props scale the render.
const VB_W = 56;
const VB_H = 168;
const PAD_TOP = 14; // neck height in viewBox units
const BODY_BOTTOM = VB_H - 2; // 166
const INNER_H = BODY_BOTTOM - PAD_TOP; // 152
const UNIT_H = INNER_H / BOTTLE_DEPTH; // 38 per liquid unit

// Test-tube shape: straight walls → rounded bottom, narrow opening at neck.
// TUBE_CAVITY clips liquid to body only; TUBE_OUTLINE draws the full silhouette.
const TUBE_CAVITY = `M 12 ${PAD_TOP} L 12 150 Q 12 ${BODY_BOTTOM} 28 ${BODY_BOTTOM} Q 44 ${BODY_BOTTOM} 44 150 L 44 ${PAD_TOP} Z`;
const TUBE_OUTLINE = `M 20 0 L 20 ${PAD_TOP} L 12 ${PAD_TOP} L 12 150 Q 12 ${BODY_BOTTOM} 28 ${BODY_BOTTOM} Q 44 ${BODY_BOTTOM} 44 150 L 44 ${PAD_TOP} L 36 ${PAD_TOP} L 36 0 Z`;

// Liquid colors are now imported from theme.bottle
export const LIQUID_COLORS = BOTTLE_LIQUID_COLORS;

const COLORBLIND_SYMBOLS: Record<Color, string> = {
  red: "▲",
  blue: "●",
  green: "■",
  yellow: "★",
  orange: "⬡",
  purple: "◆",
  pink: "✦",
  teal: "✚",
};

export const DEFAULT_BOTTLE_WIDTH = 52;
export const DEFAULT_BOTTLE_HEIGHT = 156;
// Backward-compat names used by SortBoard and snapshot tests
export const BOTTLE_WIDTH = DEFAULT_BOTTLE_WIDTH;
export const BOTTLE_HEIGHT = DEFAULT_BOTTLE_HEIGHT;

// Pour animation timing (ms) — used by reduce-motion fallback in SortScreen
export const TILT_IN_MS = 250;
export const TILT_HOLD_MS = 150;
export const TILT_OUT_MS = 200;
export const TILT_DEG = 62;

export interface BottleViewProps {
  readonly bottle: Bottle;
  readonly index: number;
  readonly selected?: boolean;
  readonly pouring?: boolean;
  readonly pouringDirection?: "left" | "right";
  readonly colorblindMode?: boolean;
  readonly bottleWidth?: number;
  readonly bottleHeight?: number;
  readonly onTap?: () => void;
  /** When true: renders the SVG only — no touch wrapper, no a11y views, no bounce. */
  readonly isGhost?: boolean;
}

export default function BottleView({
  bottle,
  index,
  selected = false,
  pouring = false,
  pouringDirection,
  colorblindMode = false,
  bottleWidth = DEFAULT_BOTTLE_WIDTH,
  bottleHeight = DEFAULT_BOTTLE_HEIGHT,
  onTap,
  isGhost = false,
}: BottleViewProps) {
  const { t } = useTranslation("sort");
  const bounceY = useSharedValue(0);
  const tiltDeg = useSharedValue(0);

  const isFilled = bottle.length > 0;
  const solved = isBottleSolved(bottle);

  // Continuous bounce while selected (skipped for ghost clones)
  useEffect(() => {
    if (isGhost) return;
    if (selected) {
      bounceY.value = withRepeat(
        withSequence(withTiming(-10, { duration: 250 }), withTiming(0, { duration: 250 })),
        -1,
        false
      );
    } else {
      cancelAnimation(bounceY);
      bounceY.value = withTiming(0, { duration: 100 });
    }
  }, [selected, bounceY, isGhost]);

  // Tilt toward target bottle while pouring
  useEffect(() => {
    if (pouring && pouringDirection) {
      const angle = pouringDirection === "right" ? TILT_DEG : -TILT_DEG;
      tiltDeg.value = withSequence(
        withTiming(angle, { duration: TILT_IN_MS }),
        withDelay(TILT_HOLD_MS, withTiming(0, { duration: TILT_OUT_MS }))
      );
    }
  }, [pouring, pouringDirection, tiltDeg]);

  const animStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: bounceY.value }, { rotate: `${tiltDeg.value}deg` }],
  }));

  let accessibilityLabel: string;
  if (selected) {
    accessibilityLabel = t("a11y.bottleSelected", { index: index + 1 });
  } else if (!isFilled) {
    accessibilityLabel = t("a11y.bottleEmpty", { index: index + 1 });
  } else if (solved) {
    accessibilityLabel = t("a11y.bottleSolved", { index: index + 1 });
  } else {
    accessibilityLabel = t("a11y.bottle", {
      index: index + 1,
      count: bottle.length,
      depth: BOTTLE_DEPTH,
    });
  }

  const clipId = `bv-clip-${index}`;
  const gradId = `bv-grad-${index}`;
  const strokeColor = selected
    ? BOTTLE_STROKE_SELECTED
    : solved && isFilled
      ? BOTTLE_STROKE_SOLVED
      : BOTTLE_STROKE_DEFAULT;
  const strokeWidth = selected ? 2 : 1.2;
  const bodyFill = selected ? BOTTLE_BODY_FILL_SELECTED : BOTTLE_BODY_FILL_DEFAULT;

  const bottleContent = (
    <Animated.View style={[{ width: bottleWidth, height: bottleHeight }, animStyle]}>
      <Svg width={bottleWidth} height={bottleHeight} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={TUBE_CAVITY} />
          </ClipPath>
          <LinearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor={BOTTLE_GLOSS_HIGHLIGHT} stopOpacity="0.12" />
            <Stop offset="0.5" stopColor={BOTTLE_GLOSS_HIGHLIGHT} stopOpacity="0" />
            <Stop offset="1" stopColor={BOTTLE_GLOSS_SHADOW} stopOpacity="0.15" />
          </LinearGradient>
        </Defs>

        {/* Glass body */}
        <Path d={TUBE_OUTLINE} fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} />

        {/* Liquid layers clipped inside cavity */}
        <G clipPath={`url(#${clipId})`}>
          {bottle.map((color, i) => {
            const y = BODY_BOTTOM - (i + 1) * UNIT_H;
            const fill = LIQUID_COLORS[color];
            return (
              <G key={i}>
                <Rect x={0} y={y} width={VB_W} height={UNIT_H + 0.5} fill={fill} />
                {/* Glossy highlight at top of each band */}
                <Rect
                  x={0}
                  y={y}
                  width={VB_W}
                  height={Math.min(4, UNIT_H * 0.12)}
                  fill={BOTTLE_LIQUID_GLOSS_FILL}
                />
                {colorblindMode && (
                  <SvgText
                    x={VB_W / 2}
                    y={y + UNIT_H / 2 + 5}
                    textAnchor="middle"
                    fontSize={Math.min(UNIT_H * 0.5, 16)}
                    fill={BOTTLE_COLORBLIND_TEXT}
                    fontWeight="700"
                  >
                    {COLORBLIND_SYMBOLS[color]}
                  </SvgText>
                )}
              </G>
            );
          })}
          {/* Glass gloss overlay */}
          <Rect x={0} y={0} width={VB_W} height={VB_H} fill={`url(#${gradId})`} />
        </G>

        {/* Cavity outline drawn on top of liquid */}
        <Path d={TUBE_CAVITY} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />

        {/* Solved checkmark badge in neck */}
        {solved && isFilled && (
          <G>
            <Circle cx={VB_W / 2} cy={PAD_TOP / 2} r={7} fill={BOTTLE_CHECKMARK_BG} />
            <Path
              d={`M ${VB_W / 2 - 3} ${PAD_TOP / 2 + 0.5} L ${VB_W / 2 - 0.5} ${PAD_TOP / 2 + 3} L ${VB_W / 2 + 3.5} ${PAD_TOP / 2 - 2}`}
              stroke={BOTTLE_CHECKMARK_STROKE}
              strokeWidth="1.8"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </G>
        )}
      </Svg>

      {/* Hidden accessible views for each liquid color — omitted for ghost clones */}
      {!isGhost &&
        bottle.map((color, i) => (
          <View
            key={`a11y-${i}`}
            accessible
            accessibilityLabel={t(`color.${color}` as const)}
            style={styles.a11yHidden}
          />
        ))}
    </Animated.View>
  );

  if (isGhost) {
    return bottleContent;
  }

  return (
    <TouchableOpacity
      onPress={onTap}
      disabled={!onTap}
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.8}
    >
      {bottleContent}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  a11yHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
  },
});
