import React, { useEffect, useRef } from "react";
import { StyleSheet, TouchableOpacity, View } from "react-native";
import type { Insets } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
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
import type { Bottle, Color } from "../../game/sort/types";
import { BOTTLE_DEPTH } from "../../game/sort/types";
import { isBottleSolved } from "../../game/sort/engine";
import { useTheme } from "../../theme/ThemeContext";
import { useReduceMotion } from "../shared/useReduceMotion";
import { ROW_GAP } from "./gridGeometry";
import {
  COMPLETE_BADGE_MS,
  COMPLETE_PULSE_MS,
  LEVEL_IN_DROP_FRAC,
  REFUSED_SHAKE_MS,
  SELECT_LIFT_MS,
  SELECT_SETTLE_MS,
  badgePopScale,
  levelInLook,
  pulseScale,
  selectLiftPx,
  shakeOffsetPx,
} from "../../game/sort/motion";
import type { Theme } from "../../theme/ThemeContext";
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
} from "../../theme/theme.bottle";

// SVG design dimensions — the viewBox stays fixed; width/height props scale the render.
// Exported: SortBoard's pour geometry reads the same numbers (one source).
export const VB_W = 56;
export const VB_H = 168;
export const PAD_TOP = 14; // neck height in viewBox units
export const BODY_BOTTOM = VB_H - 2; // 166
export const INNER_H = BODY_BOTTOM - PAD_TOP; // 152
/** Flask neck's inner left/right edges (x in viewBox units); match FLASK_CAVITY. */
export const NECK_LEFT = 18;
export const NECK_RIGHT = 38;
const UNIT_H = INNER_H / BOTTLE_DEPTH; // 38 per liquid unit

// Flask (chem-flask) shape: narrow neck flares to wide round body.
// FLASK_CAVITY clips liquid; FLASK_OUTLINE draws the full silhouette.
// Neck x: 18–38; shoulder transition at y=36; body x: 6–50; rounded bottom at y=154.
export const FLASK_CAVITY = `M 18 ${PAD_TOP} L 18 36 Q 6 52 6 154 Q 6 ${BODY_BOTTOM} 18 ${BODY_BOTTOM} L 38 ${BODY_BOTTOM} Q 50 ${BODY_BOTTOM} 50 154 Q 50 52 38 36 L 38 ${PAD_TOP} Z`;
const FLASK_OUTLINE = `M 18 0 L 18 36 Q 6 52 6 154 Q 6 ${BODY_BOTTOM} 18 ${BODY_BOTTOM} L 38 ${BODY_BOTTOM} Q 50 ${BODY_BOTTOM} 50 154 Q 50 52 38 36 L 38 0 Z`;

// Per-theme liquid color map — subscribers select by theme key.
export const LIQUID_COLORS: Record<Theme, Record<Color, string>> = BOTTLE_LIQUID_COLORS;

/**
 * One glyph per colour for Colorblind Mode (#3658). Each is a plain text glyph
 * from the Geometric Shapes, Dingbats, Arrows or Math blocks that is not emoji
 * at all (no Emoji property), so it needs no presentation selector and draws
 * the same inside SVG text on iOS and Android. The shape families are all
 * different, so no two colours look alike at a glance:
 *   triangle ▲, circle ●, square ■, star ★, hexagon ⬡, diamond ◆, asterisk ✱,
 *   plus ✚, arrow ↑, flower ✿, note ♪, infinity ∞, crescent ☾, cross ✕.
 */
export const COLORBLIND_SYMBOLS: Record<Color, string> = {
  red: "▲",
  blue: "●",
  green: "■",
  yellow: "★",
  orange: "⬡",
  purple: "◆",
  pink: "✱",
  teal: "✚",
  brown: "↑",
  lime: "✿",
  navy: "♪",
  maroon: "∞",
  gold: "☾",
  indigo: "✕",
};

export const DEFAULT_BOTTLE_WIDTH = 52;
export const DEFAULT_BOTTLE_HEIGHT = 156;

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

/** The check badge's circle radius at full size (viewBox units). */
const BADGE_R = 7;

export interface BottleViewProps {
  readonly bottle: Bottle;
  readonly index: number;
  readonly selected?: boolean;
  readonly colorblindMode?: boolean;
  readonly bottleWidth?: number;
  readonly bottleHeight?: number;
  readonly onTap?: () => void;
  /** A Hint says to pour into this bottle: its label says so, for screen readers (#3658). */
  readonly hintTarget?: boolean;
  /**
   * Extends the tap area past the bottle's visual bounds, so narrow bottles on
   * dense levels still get a full-size touch target (#2207). SortBoard sizes it
   * from computeBoardLayout so neighbouring targets never overlap.
   */
  readonly hitSlop?: Insets;
  /** When true: renders the SVG only — no touch wrapper, no a11y views, no lift. */
  readonly isGhost?: boolean;
  /**
   * Bumped by the screen each time a pour into this bottle is refused: the bottle shakes
   * once per change (#3660). The value it mounts with plays nothing, so a remount replays
   * no shake.
   */
  readonly refusedSeq?: number;
  /**
   * A new level's drop-in (#3660): the board's clock (0..1, shared by every bottle) and this
   * bottle's place in it. Omitted for a restored game, which plays nothing.
   */
  readonly entryClock?: SharedValue<number>;
  readonly entryDelayMs?: number;
  /** Ghost only: how many units the pour has taken from the top so far (a shared value). */
  readonly drained?: SharedValue<number>;
}

export default function BottleView({
  bottle,
  index,
  selected = false,
  colorblindMode = false,
  bottleWidth = DEFAULT_BOTTLE_WIDTH,
  bottleHeight = DEFAULT_BOTTLE_HEIGHT,
  onTap,
  hintTarget = false,
  hitSlop,
  isGhost = false,
  refusedSeq = 0,
  entryClock,
  entryDelayMs = 0,
  drained,
}: BottleViewProps) {
  const { t } = useTranslation("sort");
  const { theme } = useTheme();
  const liquidColors = BOTTLE_LIQUID_COLORS[theme];
  const reduceMotion = useReduceMotion();

  const isFilled = bottle.length > 0;
  const solved = isBottleSolved(bottle);
  const completed = solved && isFilled;

  // Select (#3660): one lift to `select = 1`, held until deselected. A bottle that mounts
  // selected (a restored game) is already lifted.
  const select = useSharedValue(selected && !isGhost ? 1 : 0);
  useEffect(() => {
    if (isGhost) return;
    const target = selected ? 1 : 0;
    // Already there (it mounted selected, as a restored game does): nothing to play.
    if (select.value === target) return;
    cancelAnimation(select);
    if (reduceMotion) {
      select.value = target;
      return;
    }
    select.value = withTiming(target, {
      duration: selected ? SELECT_LIFT_MS : SELECT_SETTLE_MS,
      easing: Easing.out(Easing.quad),
    });
  }, [selected, reduceMotion, select, isGhost]);

  // Refused pour (#3660): one shake per bump of `refusedSeq`.
  const shake = useSharedValue(0);
  const seenRefusedSeq = useRef(refusedSeq);
  useEffect(() => {
    if (isGhost || refusedSeq === seenRefusedSeq.current) return;
    seenRefusedSeq.current = refusedSeq;
    cancelAnimation(shake);
    shake.value = 0;
    if (reduceMotion) return;
    shake.value = withTiming(1, { duration: REFUSED_SHAKE_MS, easing: Easing.linear });
  }, [refusedSeq, reduceMotion, shake, isGhost]);

  // Bottle complete (#3660): a pulse and the check badge's pop, only when this bottle
  // becomes solved while it is on screen. One that mounts solved (a fresh board, a restore)
  // shows its badge at once.
  const pulse = useSharedValue(0);
  const badge = useSharedValue(completed ? 1 : 0);
  const wasCompleted = useRef(completed);
  useEffect(() => {
    const was = wasCompleted.current;
    wasCompleted.current = completed;
    if (isGhost || completed === was) return;
    cancelAnimation(pulse);
    cancelAnimation(badge);
    pulse.value = 0;
    if (!completed || reduceMotion) {
      badge.value = completed ? 1 : 0;
      return;
    }
    badge.value = 0;
    badge.value = withTiming(1, { duration: COMPLETE_BADGE_MS, easing: Easing.linear });
    pulse.value = withTiming(1, { duration: COMPLETE_PULSE_MS, easing: Easing.linear });
  }, [completed, reduceMotion, pulse, badge, isGhost]);

  const dropPx = bottleHeight * LEVEL_IN_DROP_FRAC;
  const animStyle = useAnimatedStyle(() => {
    const entry = entryClock ? levelInLook(entryClock.value, entryDelayMs) : null;
    return {
      opacity: entry ? entry.opacity : 1,
      transform: [
        { translateX: shakeOffsetPx(shake.value, bottleWidth) },
        {
          translateY:
            selectLiftPx(select.value, bottleHeight, ROW_GAP) - (entry ? entry.drop * dropPx : 0),
        },
        { scale: pulseScale(pulse.value) },
      ],
    };
  });

  const badgeCircleProps = useAnimatedProps(() => ({
    r: BADGE_R * badgePopScale(badge.value),
  }));
  const badgeCheckProps = useAnimatedProps(() => ({
    opacity: badgePopScale(badge.value) > 0.6 ? 1 : 0,
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
  // The ring is hidden from screen readers, so the label carries the hint's destination.
  if (hintTarget) accessibilityLabel = `${accessibilityLabel}. ${t("a11y.hintDestination")}`;

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
    <Animated.View
      testID={isGhost ? undefined : `bottle-view-${index}`}
      style={[{ width: bottleWidth, height: bottleHeight }, animStyle]}
    >
      <Svg width={bottleWidth} height={bottleHeight} viewBox={`0 0 ${VB_W} ${VB_H}`}>
        <Defs>
          <ClipPath id={clipId}>
            <Path d={FLASK_CAVITY} />
          </ClipPath>
          <LinearGradient id={gradId} x1="0" x2="1" y1="0" y2="0">
            <Stop offset="0" stopColor={BOTTLE_GLOSS_HIGHLIGHT} stopOpacity="0.12" />
            <Stop offset="0.5" stopColor={BOTTLE_GLOSS_HIGHLIGHT} stopOpacity="0" />
            <Stop offset="1" stopColor={BOTTLE_GLOSS_SHADOW} stopOpacity="0.15" />
          </LinearGradient>
        </Defs>

        {/* Glass body */}
        <Path d={FLASK_OUTLINE} fill={bodyFill} stroke={strokeColor} strokeWidth={strokeWidth} />

        {/* Liquid layers clipped inside cavity */}
        <G clipPath={`url(#${clipId})`}>
          {bottle.map((color, i) => {
            const y = BODY_BOTTOM - (i + 1) * UNIT_H;
            const fill = liquidColors[color];
            return (
              <LiquidLayer key={i} index={i} length={bottle.length} drained={drained}>
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
              </LiquidLayer>
            );
          })}
          {/* Glass gloss overlay */}
          <Rect x={0} y={0} width={VB_W} height={VB_H} fill={`url(#${gradId})`} />
        </G>

        {/* Cavity outline drawn on top of liquid */}
        <Path d={FLASK_CAVITY} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} />

        {/* Solved checkmark badge in neck */}
        {completed && (
          <G>
            <AnimatedCircle
              cx={VB_W / 2}
              cy={PAD_TOP / 2}
              r={BADGE_R}
              fill={BOTTLE_CHECKMARK_BG}
              animatedProps={badgeCircleProps}
            />
            <AnimatedPath
              animatedProps={badgeCheckProps}
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
      hitSlop={hitSlop}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      activeOpacity={0.8}
    >
      {bottleContent}
    </TouchableOpacity>
  );
}

/**
 * One liquid unit. A ghost bottle (mid-pour) passes `drained`, the units its pour has taken
 * from the top so far, and a layer hides on the UI thread when its turn comes; every other
 * bottle draws a plain group.
 */
function LiquidLayer({
  index,
  length,
  drained,
  children,
}: {
  readonly index: number;
  readonly length: number;
  readonly drained?: SharedValue<number>;
  readonly children: React.ReactNode;
}) {
  return drained ? (
    <DrainingLayer index={index} length={length} drained={drained}>
      {children}
    </DrainingLayer>
  ) : (
    <G>{children}</G>
  );
}

function DrainingLayer({
  index,
  length,
  drained,
  children,
}: {
  readonly index: number;
  readonly length: number;
  readonly drained: SharedValue<number>;
  readonly children: React.ReactNode;
}) {
  const props = useAnimatedProps(() => ({ opacity: index >= length - drained.value ? 0 : 1 }));
  return <AnimatedG animatedProps={props}>{children}</AnimatedG>;
}

const styles = StyleSheet.create({
  a11yHidden: {
    position: "absolute",
    width: 1,
    height: 1,
    overflow: "hidden",
  },
});
