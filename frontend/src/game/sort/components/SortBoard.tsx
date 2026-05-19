import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  runOnJS,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withSpring,
  withTiming,
} from "react-native-reanimated";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { Bottle, Color, SortState } from "../types";
import { BOTTLE_DEPTH } from "../types";
import { useTheme } from "../../../theme/ThemeContext";
import BottleView, {
  DEFAULT_BOTTLE_HEIGHT,
  DEFAULT_BOTTLE_WIDTH,
  FLASK_CAVITY,
  LIQUID_COLORS,
} from "./BottleView";

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);

const BOTTLE_GAP = 12;
const ASPECT_RATIO = DEFAULT_BOTTLE_WIDTH / DEFAULT_BOTTLE_HEIGHT; // ≈ 0.333

export interface SortBoardProps {
  readonly state: SortState;
  readonly colorblindMode?: boolean;
  readonly onBottleTap: (index: number) => void;
  readonly pouringFrom?: number | null;
  readonly pouringTo?: number | null;
  /** Height of the board container in pixels — used to scale bottles to fit. */
  readonly availableHeight?: number;
  /** Total flow duration in ms (POUR_PER_UNIT_MS × unitCount); computed by SortScreen. */
  readonly pourHoldMs?: number;
  /** Called when the pour animation fully completes (ghost returns to origin). */
  readonly onPourComplete?: () => void;
}

interface GhostInfo {
  bottle: Bottle;
  bottleIndex: number;
  pourColor: Color;
  startX: number;
  startY: number;
  dstX: number;
  dstY: number;
  tiltSign: 1 | -1;
  dstBottleLength: number;
}

// Pour animation timing (ms) — exported so SortScreen can compute total timeout
export const POUR_LIFT_MS = 240; // diagonal lift+travel phase
export const POUR_TILT_MS = 220; // tilt from 0° to TILT_START_DEG
export const POUR_PER_UNIT_MS = 380; // per-unit progressive tilt + stream
export const POUR_RETURN_MS = 320; // simultaneous untilt + return

// Tilt progresses from start angle to peak as the bottle empties
const TILT_START_DEG = 50;
const TILT_PEAK_DEG = 95;

// BottleView SVG proportions — must stay in sync with BottleView flask shape
const VB_W = 56;
const VB_H = 168;
const NECK_TOP_VB = 14; // PAD_TOP in BottleView
const NECK_LEFT_VB = 18; // flask inner neck left edge
const NECK_RIGHT_VB = 38; // flask inner neck right edge
const BODY_BOTTOM_VB = 166;
const INNER_H_VB = BODY_BOTTOM_VB - NECK_TOP_VB; // 152

// ms for poured liquid to travel from spout to settle in destination
const POUR_TRAVEL_MS = 160;

const STREAM_WIDTH = 6;
const STREAM_GLOW_WIDTH = 14;
const STREAM_HIGHLIGHT_WIDTH = 1.4;

export default function SortBoard({
  state,
  colorblindMode = false,
  onBottleTap,
  pouringFrom = null,
  pouringTo = null,
  availableHeight,
  pourHoldMs = POUR_PER_UNIT_MS,
  onPourComplete,
}: SortBoardProps) {
  const { t } = useTranslation("sort");
  const { theme } = useTheme();
  const liquidColors = LIQUID_COLORS[theme];
  const { width: screenW } = useWindowDimensions();

  const numBottles = state.bottles.length;
  // Single row for ≤4 bottles; 3 cols for 5–6; 4 cols for 7+
  const numCols = numBottles <= 4 ? numBottles : numBottles <= 6 ? 3 : 4;
  const numRows = Math.ceil(numBottles / numCols);

  // Scale bottles to fill available height without overflow
  const avH = availableHeight && availableHeight > 0 ? availableHeight : 480;
  const maxBottleH = Math.max(60, (avH - BOTTLE_GAP * (numRows - 1)) / numRows);
  const bottleHFromHeight = Math.min(DEFAULT_BOTTLE_HEIGHT, maxBottleH);

  // Also clamp to horizontal space so bottles never overflow screen width
  const horizPad = 32;
  const maxBottleW = (screenW - horizPad - BOTTLE_GAP * (numCols - 1)) / numCols;
  const bottleW = Math.min(bottleHFromHeight * ASPECT_RATIO, maxBottleW);
  const bottleH = bottleW / ASPECT_RATIO;

  // Reduce-motion: fall back to tilt-only (no ghost overlay)
  const [reduceMotion, setReduceMotion] = useState(false);
  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  // Position tracking — updated by onLayout, never triggers re-render.
  // React Native fires onLayout top-down (parent before children), so
  // gridOffsetRef is populated before any bottle cell onLayout runs.
  const gridOffsetRef = useRef({ x: 0, y: 0 });
  const bottlePositionsRef = useRef<{ x: number; y: number }[]>([]);

  // Ghost shared values — always allocated (hooks can't be conditional)
  const ghostDy = useSharedValue(0);
  const ghostDx = useSharedValue(0);
  const ghostTiltDeg = useSharedValue(0);
  const ghostStreamOpacity = useSharedValue(0);
  // Pivot offset from element center to spout/neck corner — set when ghost is created
  const ghostPivotOffX = useSharedValue(0);
  const ghostPivotOffY = useSharedValue(0);

  // Simulate CSS transformOrigin at the spout corner by bracketing rotate with
  // a pre-shift (pivot to center) and post-shift (center back to pivot).
  const ghostAnimStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: ghostDx.value + ghostPivotOffX.value },
      { translateY: ghostDy.value + ghostPivotOffY.value },
      { rotate: `${ghostTiltDeg.value}deg` },
      { translateX: -ghostPivotOffX.value },
      { translateY: -ghostPivotOffY.value },
    ],
  }));

  const ghostStreamStyle = useAnimatedStyle(() => ({
    opacity: ghostStreamOpacity.value,
  }));

  // Ghost React state (drives overlay visibility and bottle capture)
  const [ghost, setGhost] = useState<GhostInfo | null>(null);
  const [unitsEmitted, setUnitsEmitted] = useState(0);
  const [unitsLanded, setUnitsLanded] = useState(0);
  const emitTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const landTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Animated splash at landing point
  const splashRx = useSharedValue(4);
  const splashOpacity = useSharedValue(0);
  const splashProps = useAnimatedProps(() => ({
    rx: splashRx.value,
    opacity: splashOpacity.value,
  }));

  // Stable wrapper so the worklet can invoke onPourComplete via runOnJS without
  // capturing a stale closure — the ref is updated on every render.
  const onPourCompleteRef = useRef(onPourComplete);
  onPourCompleteRef.current = onPourComplete;
  const notifyPourComplete = useCallback(() => {
    onPourCompleteRef.current?.();
  }, []);

  // Stable ref for values read inside the effect (avoids stale closure without
  // adding them to the dep array, which would re-trigger on every state change)
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    if (pouringFrom === null || pouringTo === null || reduceMotion) {
      cancelAnimation(ghostDy);
      cancelAnimation(ghostDx);
      cancelAnimation(ghostTiltDeg);
      cancelAnimation(ghostStreamOpacity);
      ghostDy.value = 0;
      ghostDx.value = 0;
      ghostTiltDeg.value = 0;
      ghostStreamOpacity.value = 0;
      ghostPivotOffX.value = 0;
      ghostPivotOffY.value = 0;
      setGhost(null);
      setUnitsEmitted(0);
      setUnitsLanded(0);
      return;
    }

    const srcPos = bottlePositionsRef.current[pouringFrom];
    const dstPos = bottlePositionsRef.current[pouringTo];
    if (!srcPos || !dstPos) return;

    const sourceBottle = stateRef.current.bottles[pouringFrom];
    const dstBottle = stateRef.current.bottles[pouringTo];
    if (!sourceBottle) return;

    const isRight = pouringFrom < pouringTo;
    const tiltSign: 1 | -1 = isRight ? 1 : -1;

    // Spout pivot: outer neck edge scaled from viewBox coords to bottleW/H
    const pivotLocalX = ((isRight ? NECK_RIGHT_VB : NECK_LEFT_VB) / VB_W) * bottleW;
    const pivotLocalY = (NECK_TOP_VB / VB_H) * bottleH;

    // Pivot offset from bottle center — used to rotate around the spout corner.
    ghostPivotOffX.value = pivotLocalX - bottleW / 2;
    ghostPivotOffY.value = pivotLocalY - bottleH / 2;

    // Diagonal lift: position spout just above the destination neck opening.
    // liftDx moves the spout (not center) to dst center-X; liftDy aligns neck tops.
    const liftDx = dstPos.x + bottleW / 2 - (srcPos.x + pivotLocalX);
    const liftDy = dstPos.y - srcPos.y - 8;

    const unitCount = Math.max(1, Math.round(pourHoldMs / POUR_PER_UNIT_MS));
    const pourColor = sourceBottle[sourceBottle.length - 1] ?? ("red" as Color);

    setUnitsEmitted(0);
    setUnitsLanded(0);

    ghostDx.value = 0;
    ghostDy.value = 0;
    ghostTiltDeg.value = 0;
    ghostStreamOpacity.value = 0;

    setGhost({
      bottle: sourceBottle,
      bottleIndex: pouringFrom,
      pourColor,
      startX: srcPos.x,
      startY: srcPos.y,
      dstX: dstPos.x,
      dstY: dstPos.y,
      tiltSign,
      dstBottleLength: dstBottle?.length ?? 0,
    });

    // Phase 1: Diagonal lift+travel simultaneously (POUR_LIFT_MS)
    ghostDx.value = withTiming(liftDx, { duration: POUR_LIFT_MS });
    ghostDy.value = withTiming(liftDy, { duration: POUR_LIFT_MS }, (finished) => {
      if (!finished) return;
      // Phase 2: Tilt to TILT_START_DEG
      ghostTiltDeg.value = withTiming(
        tiltSign * TILT_START_DEG,
        { duration: POUR_TILT_MS },
        (finished) => {
          if (!finished) return;
          // Phase 3: Progressive tilt to TILT_PEAK_DEG over full pour
          ghostTiltDeg.value = withTiming(
            tiltSign * TILT_PEAK_DEG,
            { duration: pourHoldMs },
            (finished) => {
              if (!finished) return;
              // Phase 4: Simultaneous untilt + diagonal return
              ghostTiltDeg.value = withTiming(0, { duration: POUR_RETURN_MS });
              ghostDx.value = withTiming(0, { duration: POUR_RETURN_MS });
              ghostDy.value = withTiming(0, { duration: POUR_RETURN_MS }, (finished) => {
                if (!finished) return;
                runOnJS(setGhost)(null);
                runOnJS(setUnitsEmitted)(0);
                runOnJS(notifyPourComplete)();
              });
            }
          );
        }
      );
    });

    // Stream fades in as tilt starts, fades out when return begins
    ghostStreamOpacity.value = withDelay(
      POUR_LIFT_MS,
      withSequence(
        withTiming(1, { duration: POUR_TILT_MS }),
        withDelay(pourHoldMs, withTiming(0, { duration: POUR_RETURN_MS / 2 }))
      )
    );

    // Schedule per-unit drain (source ghost) and land (destination fill) timers
    const flowStart = POUR_LIFT_MS + POUR_TILT_MS;
    for (let i = 1; i <= unitCount; i++) {
      const emitAt = flowStart + (i - 1) * POUR_PER_UNIT_MS + POUR_PER_UNIT_MS * 0.6;
      const landAt = emitAt + POUR_TRAVEL_MS;
      const captured = i;
      emitTimersRef.current.push(setTimeout(() => setUnitsEmitted(captured), emitAt));
      landTimersRef.current.push(setTimeout(() => setUnitsLanded(captured), landAt));
    }

    return () => {
      emitTimersRef.current.forEach(clearTimeout);
      emitTimersRef.current = [];
      landTimersRef.current.forEach(clearTimeout);
      landTimersRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pouringFrom, pouringTo, reduceMotion, pourHoldMs]);

  // Pulse the splash ellipse on each unit landing
  useEffect(() => {
    if (unitsLanded === 0) return;
    splashRx.value = 4;
    splashRx.value = withTiming(14, { duration: 200 });
    splashOpacity.value = 0.7;
    splashOpacity.value = withTiming(0, { duration: 280 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unitsLanded]);

  // Pour tilt direction — used for reduce-motion fallback only
  const pouringDirection: "left" | "right" | undefined =
    pouringFrom !== null && pouringTo !== null
      ? pouringFrom < pouringTo
        ? "right"
        : "left"
      : undefined;

  const handlers = useMemo(
    () => state.bottles.map((_, idx) => () => onBottleTap(idx)),
    // state.bottles identity changes on every pour; keying on .length avoids
    // rebuilding all handlers when only liquid positions change. onBottleTap is
    // included so callers that wrap it in useCallback get stable handles too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.bottles.length, onBottleTap]
  );

  // Stream arc geometry — computed from ghost snapshot each render.
  let streamPath = "";
  let streamColor = "transparent";
  let spoutX = 0;
  let spoutY = 0;
  let streamEndY = 0;
  if (ghost !== null) {
    const pivotLocalY = (NECK_TOP_VB / VB_H) * bottleH;
    const unitHPx = (INNER_H_VB / VB_H / BOTTLE_DEPTH) * bottleH;
    // Spout is fixed at dst center-X, 8px above dst neck (matches liftDy offset)
    spoutX = ghost.dstX + bottleW / 2;
    spoutY = ghost.dstY + pivotLocalY - 8;
    const dstFillTopY =
      ghost.dstY + (BODY_BOTTOM_VB / VB_H) * bottleH - ghost.dstBottleLength * unitHPx;
    streamEndY = Math.max(spoutY + 12, dstFillTopY);
    const arcSag = Math.max(6, (streamEndY - spoutY) * 0.18);
    const ctrlX = spoutX + ghost.tiltSign * 4;
    const ctrlY = (spoutY + streamEndY) / 2 + arcSag;
    streamPath = `M ${spoutX} ${spoutY} Q ${ctrlX} ${ctrlY} ${spoutX} ${streamEndY}`;
    const topColor = ghost.bottle[ghost.bottle.length - 1];
    streamColor = topColor ? liquidColors[topColor] : "transparent";
  }

  // Draining ghost contents: slice from top as units emit
  const ghostBottle =
    ghost !== null ? ghost.bottle.slice(0, Math.max(0, ghost.bottle.length - unitsEmitted)) : [];

  return (
    <View accessibilityLabel={t("a11y.boardRegion")} accessibilityRole="none" style={styles.board}>
      <View
        style={[styles.grid, { gap: BOTTLE_GAP }]}
        onLayout={(e) => {
          gridOffsetRef.current = {
            x: e.nativeEvent.layout.x,
            y: e.nativeEvent.layout.y,
          };
        }}
      >
        {state.bottles.map((bottle, idx) => (
          <View
            key={idx}
            style={[
              styles.bottleCell,
              { width: bottleW },
              idx === pouringFrom && ghost !== null ? styles.bottleHidden : null,
            ]}
            onLayout={(e) => {
              bottlePositionsRef.current[idx] = {
                x: gridOffsetRef.current.x + e.nativeEvent.layout.x,
                y: gridOffsetRef.current.y + e.nativeEvent.layout.y,
              };
            }}
          >
            <BottleView
              bottle={bottle}
              index={idx}
              selected={state.selectedBottleIndex === idx}
              pouring={reduceMotion ? idx === pouringFrom : false}
              pouringDirection={reduceMotion && idx === pouringFrom ? pouringDirection : undefined}
              colorblindMode={colorblindMode}
              bottleWidth={bottleW}
              bottleHeight={bottleH}
              onTap={handlers[idx]}
            />
          </View>
        ))}
      </View>

      {/* Ghost bottle overlay — floats above grid during pour animation.
          ghost is only set when !reduceMotion, so the extra guard is omitted. */}
      {ghost !== null && (
        <View
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* Destination highlight ring — glows in pour color */}
          {streamColor !== "transparent" && (
            <View
              style={[
                styles.dstRing,
                {
                  left: ghost.dstX - 4,
                  top: ghost.dstY - 4,
                  width: bottleW + 8,
                  height: bottleH + 8,
                  borderColor: streamColor + "88",
                },
              ]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          )}

          {/* Destination rising fill — units appear in target bottle as they land */}
          {unitsLanded > 0 && (
            <View
              style={[
                styles.dstFillOverlay,
                { left: ghost.dstX, top: ghost.dstY, width: bottleW, height: bottleH },
              ]}
              pointerEvents="none"
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            >
              <Svg width={bottleW} height={bottleH} viewBox={`0 0 ${VB_W} ${VB_H}`}>
                <Defs>
                  <ClipPath id={`dst-fill-${ghost.bottleIndex}-${ghost.dstX}`}>
                    <Path d={FLASK_CAVITY} />
                  </ClipPath>
                </Defs>
                <G clipPath={`url(#dst-fill-${ghost.bottleIndex}-${ghost.dstX})`}>
                  {(() => {
                    const unitHVb = INNER_H_VB / BOTTLE_DEPTH;
                    const fillColor = liquidColors[ghost.pourColor];
                    return Array.from({ length: unitsLanded }).map((_, k) => {
                      const yVb = BODY_BOTTOM_VB - (ghost.dstBottleLength + k + 1) * unitHVb;
                      return (
                        <G key={k}>
                          <Rect
                            x={0}
                            y={yVb}
                            width={VB_W}
                            height={unitHVb + 0.5}
                            fill={fillColor}
                          />
                          <Rect
                            x={0}
                            y={yVb}
                            width={VB_W}
                            height={2.5}
                            fill="rgba(255,255,255,0.22)"
                          />
                        </G>
                      );
                    });
                  })()}
                </G>
              </Svg>
            </View>
          )}
          {streamPath !== "" && (
            <Animated.View style={[StyleSheet.absoluteFill, ghostStreamStyle]} pointerEvents="none">
              <Svg width="100%" height="100%">
                {/* Soft glow layer behind the stream */}
                <Path
                  d={streamPath}
                  stroke={streamColor}
                  strokeWidth={STREAM_GLOW_WIDTH}
                  strokeOpacity={0.25}
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Main stream */}
                <Path
                  d={streamPath}
                  stroke={streamColor}
                  strokeWidth={STREAM_WIDTH}
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Inner white highlight */}
                <Path
                  d={streamPath}
                  stroke="rgba(255,255,255,0.4)"
                  strokeWidth={STREAM_HIGHLIGHT_WIDTH}
                  fill="none"
                  strokeLinecap="round"
                />
                {/* Bead forming at the spout */}
                <Circle cx={spoutX} cy={spoutY + 1} r={3.5} fill={streamColor} opacity={0.95} />
                {/* Splash ellipse at landing — animates on each unit landing */}
                <AnimatedEllipse
                  cx={spoutX}
                  cy={streamEndY}
                  ry={2}
                  fill={streamColor}
                  animatedProps={splashProps}
                />
              </Svg>
            </Animated.View>
          )}
          <Animated.View
            style={[
              styles.ghostBottle,
              {
                left: ghost.startX,
                top: ghost.startY,
                width: bottleW,
                height: bottleH,
              },
              ghostAnimStyle,
            ]}
          >
            <BottleView
              bottle={ghostBottle}
              index={ghost.bottleIndex}
              isGhost
              colorblindMode={colorblindMode}
              bottleWidth={bottleW}
              bottleHeight={bottleH}
            />
          </Animated.View>
        </View>
      )}

      <SortWinOverlay visible={state.isComplete} />
    </View>
  );
}

// ---------------------------------------------------------------------------
// Win overlay — liquid-coloured confetti cascades down when the puzzle is solved
// ---------------------------------------------------------------------------

interface OverlayProps {
  readonly visible: boolean;
}

const CONFETTI_KEYS: Color[] = ["red", "orange", "green", "blue", "purple", "pink"];

function SortWinOverlay({ visible }: OverlayProps) {
  const { theme } = useTheme();
  const liquidColors = LIQUID_COLORS[theme];
  const particleColors = CONFETTI_KEYS.map((k) => liquidColors[k]);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setReduceMotion);
  }, []);

  const y0 = useSharedValue(-60);
  const y1 = useSharedValue(-60);
  const y2 = useSharedValue(-60);
  const y3 = useSharedValue(-60);
  const y4 = useSharedValue(-60);
  const y5 = useSharedValue(-60);
  const op0 = useSharedValue(0);
  const op1 = useSharedValue(0);
  const op2 = useSharedValue(0);
  const op3 = useSharedValue(0);
  const op4 = useSharedValue(0);
  const op5 = useSharedValue(0);

  useEffect(() => {
    if (!visible || reduceMotion) return;

    const ys = [y0, y1, y2, y3, y4, y5];
    const ops = [op0, op1, op2, op3, op4, op5];

    ys.forEach((y, i) => {
      y.value = -60;
      y.value = withDelay(i * 100, withSpring(500, { damping: 14, stiffness: 55 }));
    });
    ops.forEach((op, i) => {
      op.value = 0;
      op.value = withDelay(
        i * 100,
        withSequence(
          withTiming(1, { duration: 80 }),
          withDelay(600, withTiming(0, { duration: 400 }))
        )
      );
    });

    return () => {
      [y0, y1, y2, y3, y4, y5].forEach((v) => cancelAnimation(v));
      [op0, op1, op2, op3, op4, op5].forEach((v) => cancelAnimation(v));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const a0 = useAnimatedStyle(() => ({
    transform: [{ translateY: y0.value }],
    opacity: op0.value,
  }));
  const a1 = useAnimatedStyle(() => ({
    transform: [{ translateY: y1.value }],
    opacity: op1.value,
  }));
  const a2 = useAnimatedStyle(() => ({
    transform: [{ translateY: y2.value }],
    opacity: op2.value,
  }));
  const a3 = useAnimatedStyle(() => ({
    transform: [{ translateY: y3.value }],
    opacity: op3.value,
  }));
  const a4 = useAnimatedStyle(() => ({
    transform: [{ translateY: y4.value }],
    opacity: op4.value,
  }));
  const a5 = useAnimatedStyle(() => ({
    transform: [{ translateY: y5.value }],
    opacity: op5.value,
  }));

  if (!visible || reduceMotion) return null;

  return (
    <View
      style={StyleSheet.absoluteFill}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Animated.View
        style={[styles.particle, styles.p0, { backgroundColor: particleColors[0] }, a0]}
      />
      <Animated.View
        style={[styles.particle, styles.p1, { backgroundColor: particleColors[1] }, a1]}
      />
      <Animated.View
        style={[styles.particle, styles.p2, { backgroundColor: particleColors[2] }, a2]}
      />
      <Animated.View
        style={[styles.particle, styles.p3, { backgroundColor: particleColors[3] }, a3]}
      />
      <Animated.View
        style={[styles.particle, styles.p4, { backgroundColor: particleColors[4] }, a4]}
      />
      <Animated.View
        style={[styles.particle, styles.p5, { backgroundColor: particleColors[5] }, a5]}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  board: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "center",
    alignItems: "center",
  },
  bottleCell: {
    alignItems: "center",
  },
  bottleHidden: {
    opacity: 0,
  },
  ghostBottle: {
    position: "absolute",
  },
  dstRing: {
    position: "absolute",
    borderRadius: 14,
    borderWidth: 2,
    pointerEvents: "none",
  },
  dstFillOverlay: {
    position: "absolute",
    pointerEvents: "none",
  },
  particle: { position: "absolute", width: 20, height: 20, borderRadius: 10, top: 0 },
  p0: { left: "8%" },
  p1: { left: "22%" },
  p2: { left: "36%" },
  p3: { left: "52%" },
  p4: { left: "66%" },
  p5: { left: "80%" },
});
