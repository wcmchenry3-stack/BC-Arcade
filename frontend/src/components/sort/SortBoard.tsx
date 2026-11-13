import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Pressable, StyleSheet, useWindowDimensions, View } from "react-native";
import Animated, {
  cancelAnimation,
  Easing,
  runOnJS,
  useAnimatedProps,
  useAnimatedReaction,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSequence,
  withTiming,
} from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import Svg, { Circle, ClipPath, Defs, Ellipse, G, Path, Rect } from "react-native-svg";
import { useTranslation } from "react-i18next";
import type { Bottle, Color, SortState } from "../../game/sort/types";
import { BOTTLE_DEPTH } from "../../game/sort/types";
import { useTheme } from "../../theme/ThemeContext";
import { BOTTLE_LIQUID_SHEEN, BOTTLE_STREAM_HIGHLIGHT } from "../../theme/theme.bottle";
import {
  LEVEL_IN_TOTAL_MS,
  POUR_LIFT_MS,
  POUR_RETURN_MS,
  POUR_TILT_MS,
  POUR_UNIT_MS,
  SPLASH_FADE_MS,
  SPLASH_GROW_MS,
  SPLASH_RX_FROM,
  SPLASH_RX_TO,
  STREAM_GLOW_WIDTH,
  STREAM_HIGHLIGHT_WIDTH,
  STREAM_WIDTH,
  TILT_PEAK_DEG,
  TILT_START_DEG,
  UNDO_FADE_FROM,
  UNDO_FADE_MS,
  WIN_CASCADE_FADE_OUT_MS,
  WIN_CASCADE_HOLD_MS,
  WIN_CASCADE_MS,
  WIN_CASCADE_PIECE_PX,
  WIN_CASCADE_STAGGER_MS,
  levelInDelayMs,
  pourTimeline,
} from "../../game/sort/motion";
import BottleView, {
  DEFAULT_BOTTLE_HEIGHT,
  DEFAULT_BOTTLE_WIDTH,
  FLASK_CAVITY,
  LIQUID_COLORS,
  VB_W,
  VB_H,
  PAD_TOP as NECK_TOP_VB,
  NECK_LEFT as NECK_LEFT_VB,
  NECK_RIGHT as NECK_RIGHT_VB,
  BODY_BOTTOM as BODY_BOTTOM_VB,
  INNER_H as INNER_H_VB,
} from "./BottleView";
import { BOARD_HORIZONTAL_PAD, computeBoardLayout } from "./gridGeometry";
import { ConfettiFall, type ConfettiFallTiming } from "../shared/ConfettiFall";
import { useReduceMotion } from "../shared/useReduceMotion";

const AnimatedEllipse = Animated.createAnimatedComponent(Ellipse);
const AnimatedG = Animated.createAnimatedComponent(G);

interface Offset {
  x: number;
  y: number;
}
/** A bottle cell's layout, relative to its row (which is relative to the grid). */
interface CellLayout extends Offset {
  row: number;
}

/**
 * Position of a bottle's top-left corner within the board: grid + row + cell
 * offsets, plus the bottle's inset within its (wider) cell. Undefined until
 * both the cell's and its row's onLayout have landed, so a pour is never drawn
 * from a partial (row-less) position.
 */
function resolveBottlePos(
  grid: Offset,
  rowOffsets: readonly Offset[],
  cell: CellLayout | undefined,
  bottleInsetX: number
): Offset | undefined {
  const row = cell ? rowOffsets[cell.row] : undefined;
  if (!cell || !row) return undefined;
  return { x: grid.x + row.x + cell.x + bottleInsetX, y: grid.y + row.y + cell.y };
}
const BOTTLE_SIZE = { width: DEFAULT_BOTTLE_WIDTH, height: DEFAULT_BOTTLE_HEIGHT };

export interface SortBoardProps {
  readonly state: SortState;
  readonly colorblindMode?: boolean;
  readonly onBottleTap: (index: number) => void;
  readonly pouringFrom?: number | null;
  readonly pouringTo?: number | null;
  /**
   * The bottle a Hint says to pour into (#3658): ringed as the pour's destination
   * is, until the screen clears it. Its cell draws the ring, so it follows the
   * bottle at any size with no measured position.
   */
  readonly hintTo?: number | null;
  /** Height of the board container in pixels — used to scale bottles to fit. */
  readonly availableHeight?: number;
  /** Total flow duration in ms (`pourFlowMs(units)`, motion.ts); computed by SortScreen. */
  readonly pourHoldMs?: number;
  /** Called when the pour animation fully completes (ghost returns to origin). */
  readonly onPourComplete?: () => void;
  /**
   * The bottle whose pour was just refused (#3660). It shakes once per new `seq`; the
   * value present at mount plays nothing.
   */
  readonly refused?: { readonly index: number; readonly seq: number } | null;
  /** Bumped on each undo: the board fades in from the previous one (#3660). */
  readonly undoSeq?: number;
  /**
   * A new level (not a restored game): the bottles drop in, staggered, over
   * `LEVEL_IN_TOTAL_MS`. Read at mount; a tap on a bottle skips it.
   */
  readonly levelIn?: boolean;
  /** The win cascade is playing (#3660). `onWinCascadeDone` follows its end or a tap. */
  readonly winCascade?: boolean;
  readonly onWinCascadeDone?: () => void;
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
  units: number;
}

/**
 * A shared-value animation that steps 1, 2, 3 ... at the given times (ms from now). The UI
 * thread runs it; nothing is scheduled in JS.
 */
function stepsAt(timesMs: readonly number[]): number {
  let prev = 0;
  const steps = timesMs.map((t, i) => {
    const delay = Math.max(0, t - prev - 1);
    prev = t;
    return withDelay(delay, withTiming(i + 1, { duration: 1 }));
  });
  return withSequence(...steps) as unknown as number;
}

export default function SortBoard({
  state,
  colorblindMode = false,
  onBottleTap,
  pouringFrom = null,
  pouringTo = null,
  hintTo = null,
  availableHeight,
  pourHoldMs = POUR_UNIT_MS,
  onPourComplete,
  refused = null,
  undoSeq = 0,
  levelIn = false,
  winCascade = false,
  onWinCascadeDone,
}: SortBoardProps) {
  const { t } = useTranslation("sort");
  const { theme, colors } = useTheme();
  const liquidColors = LIQUID_COLORS[theme];
  const { width: screenW } = useWindowDimensions();

  const numBottles = state.bottles.length;
  // Scale bottles to the available height and width; each bottle gets a cell
  // that is at least a full-size tap target wide (#2207).
  const avH = availableHeight && availableHeight > 0 ? availableHeight : 480;
  const { rowCounts, bottleW, bottleH, slotW, rowGap, bottleInsetX, hitSlop } = useMemo(
    () => computeBoardLayout(numBottles, screenW - BOARD_HORIZONTAL_PAD, avH, BOTTLE_SIZE),
    [numBottles, screenW, avH]
  );
  // Row descriptors (start index into state.bottles + bottle count), derived
  // from rowCounts — used to slice bottles into explicit row groups below
  // (see #2426: relying on flexWrap to infer row breaks from a computed
  // bottle width let the actual on-device wrap diverge from this shape,
  // e.g. 6+1 instead of 4+3).
  const rows = useMemo(() => {
    let acc = 0;
    return rowCounts.map((count) => {
      const start = acc;
      acc += count;
      return { start, count };
    });
  }, [rowCounts]);

  // Reduce-motion: fall back to tilt-only (no ghost overlay)
  const reduceMotion = useReduceMotion();

  // Position tracking — updated by onLayout, never triggers re-render.
  // RN reports each layout x/y relative to its immediate parent, so a bottle's
  // position within the board is grid + row + cell. The three are stored
  // separately and summed at read time (bottlePos), which keeps the result
  // independent of the order onLayout events happen to arrive in.
  const gridOffsetRef = useRef<Offset>({ x: 0, y: 0 });
  const rowOffsetsRef = useRef<Offset[]>([]);
  const cellLayoutsRef = useRef<CellLayout[]>([]);
  const bottlePos = (idx: number) =>
    resolveBottlePos(
      gridOffsetRef.current,
      rowOffsetsRef.current,
      cellLayoutsRef.current[idx],
      bottleInsetX
    );

  // SortScreen also forces a fresh SortBoard instance on every level change
  // (key={currentLevelId}), which alone gives the refs above a clean start.
  // This effect is a second, independent layer of protection: it doesn't
  // assume the caller remounts us, so SortBoard stays correct even if reused
  // in place (SortScreen's handleNextLevel used to do exactly that — see
  // #2297). A different bottle count means a different grid (numCols, numRows
  // and rowCounts), so cached positions from the previous level's layout no
  // longer describe the new one.
  //
  // The grid view below is keyed on numBottles for the same reason: RN only
  // fires onLayout for a view whose frame changed, so after this reset a row
  // or cell that happened to keep its frame would never report again and its
  // bottle could never be poured from or into. Remounting the grid makes every
  // row and cell report afresh.
  //
  // Uses useLayoutEffect (not useEffect) so the reset is committed
  // synchronously, before React/React Native can deliver any onLayout event
  // for the just-rendered grid — onLayout is bridged asynchronously from
  // native, so a plain useEffect racing against it could clear positions
  // *after* fresh onLayout data for the new grid had already landed, wiping
  // out correct data instead of stale data. The srcPos/dstPos guard in the
  // pour effect below then treats every bottle as "not yet positioned" until
  // fresh onLayout events for the new grid land, instead of computing a
  // pour's ghost/highlight/stream from stale coordinates.
  useLayoutEffect(() => {
    cellLayoutsRef.current = [];
    rowOffsetsRef.current = [];
    gridOffsetRef.current = { x: 0, y: 0 };
  }, [numBottles]);

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

  // Ghost React state: drives overlay visibility and bottle capture. Set once at the start of
  // a pour and cleared once at its end.
  const [ghost, setGhost] = useState<GhostInfo | null>(null);
  // How many units have left the source and landed in the destination (#3660). Shared values,
  // stepped on the UI thread by the pour's timeline: a pour renders no React per unit.
  const unitsEmitted = useSharedValue(0);
  const unitsLanded = useSharedValue(0);

  // Animated splash at landing point
  const splashRx = useSharedValue(SPLASH_RX_FROM);
  const splashOpacity = useSharedValue(0);
  const splashProps = useAnimatedProps(() => ({
    rx: splashRx.value,
    opacity: splashOpacity.value,
  }));
  // Pulse the splash ellipse on each unit landing
  useAnimatedReaction(
    () => unitsLanded.value,
    (landed, previous) => {
      if (landed === 0 || landed === previous) return;
      splashRx.value = SPLASH_RX_FROM;
      splashRx.value = withTiming(SPLASH_RX_TO, { duration: SPLASH_GROW_MS });
      splashOpacity.value = 0.7;
      splashOpacity.value = withTiming(0, { duration: SPLASH_FADE_MS });
    }
  );

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
      cancelAnimation(unitsEmitted);
      cancelAnimation(unitsLanded);
      ghostDy.value = 0;
      ghostDx.value = 0;
      ghostTiltDeg.value = 0;
      ghostStreamOpacity.value = 0;
      ghostPivotOffX.value = 0;
      ghostPivotOffY.value = 0;
      unitsEmitted.value = 0;
      unitsLanded.value = 0;
      setGhost(null);
      // Reduce Motion is live: turned on mid-pour, it drops the ghost that
      // would have finished this pour, so finish it here (a no-op on
      // SortScreen's reduce-motion timer path, which queues no pending pour).
      if (pouringFrom !== null && pouringTo !== null) notifyPourComplete();
      return;
    }

    const srcPos = bottlePos(pouringFrom);
    const dstPos = bottlePos(pouringTo);
    const sourceBottle = stateRef.current.bottles[pouringFrom];
    const dstBottle = stateRef.current.bottles[pouringTo];
    if (!srcPos || !dstPos || !sourceBottle) {
      // No trustworthy position yet (a pour started before this grid's
      // onLayout landed, e.g. right after Next Level): draw nothing rather than
      // a ring/stream from stale or partial coordinates (#2297), but still
      // finish the pour. SortScreen applies the move and clears isPouring only
      // in onPourComplete, so returning without it left the board frozen.
      notifyPourComplete();
      return;
    }

    // Use visual x-position (not index) so cross-row pours tilt toward the
    // actual destination — index order breaks in multi-row grids (e.g. level 15).
    const isRight = srcPos.x < dstPos.x;
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

    const unitCount = Math.max(1, Math.round(pourHoldMs / POUR_UNIT_MS));
    const timeline = pourTimeline(unitCount);
    const pourColor = sourceBottle[sourceBottle.length - 1] ?? ("red" as Color);

    unitsEmitted.value = 0;
    unitsLanded.value = 0;
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
      units: unitCount,
    });

    // The whole pour is one timeline per shared value, built here in one go and started on
    // the same frame: lift and travel, tilt, the progressive tilt over the flow, then untilt
    // and return. No finished-callback hands off from one phase to the next (each hop slipped
    // a frame, #3660); the only callback is on the last segment, which lands the move.
    ghostDx.value = withSequence(
      withTiming(liftDx, { duration: POUR_LIFT_MS }),
      withDelay(POUR_TILT_MS + pourHoldMs, withTiming(0, { duration: POUR_RETURN_MS }))
    );
    ghostTiltDeg.value = withDelay(
      POUR_LIFT_MS,
      withSequence(
        withTiming(tiltSign * TILT_START_DEG, { duration: POUR_TILT_MS }),
        withTiming(tiltSign * TILT_PEAK_DEG, { duration: pourHoldMs }),
        withTiming(0, { duration: POUR_RETURN_MS })
      )
    );
    ghostDy.value = withSequence(
      withTiming(liftDy, { duration: POUR_LIFT_MS }),
      withDelay(
        POUR_TILT_MS + pourHoldMs,
        withTiming(0, { duration: POUR_RETURN_MS }, (finished) => {
          if (!finished) return;
          runOnJS(setGhost)(null);
          runOnJS(notifyPourComplete)();
        })
      )
    );

    // Stream fades in as tilt starts, fades out when return begins
    ghostStreamOpacity.value = withDelay(
      POUR_LIFT_MS,
      withSequence(
        withTiming(1, { duration: POUR_TILT_MS }),
        withDelay(pourHoldMs, withTiming(0, { duration: POUR_RETURN_MS / 2 }))
      )
    );

    // Each unit's drain (source ghost) and landing (destination fill) is a step of a shared
    // value on the pour's own timeline, from `pourTimeline`: no timers, no React state.
    unitsEmitted.value = stepsAt(timeline.units.map((u) => u.leaveMs));
    unitsLanded.value = stepsAt(timeline.units.map((u) => u.landMs));

    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pouringFrom, pouringTo, reduceMotion, pourHoldMs]);

  // Level-in (#3660): one clock for the board, 0 -> 1 over LEVEL_IN_TOTAL_MS; each bottle
  // reads its own slice of it on the UI thread. A tap sets it to 1, which skips the rest. A
  // restored game (`levelIn` false) or Reduce Motion starts at 1 and plays nothing.
  const playLevelIn = levelIn && !reduceMotion;
  const entryClock = useSharedValue(playLevelIn ? 0 : 1);
  useEffect(() => {
    if (!playLevelIn) return;
    entryClock.value = withTiming(1, { duration: LEVEL_IN_TOTAL_MS, easing: Easing.linear });
    // Mount only: a level change remounts the board (SortScreen keys it by level).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const skipLevelIn = useCallback(() => {
    if (entryClock.value >= 1) return;
    cancelAnimation(entryClock);
    entryClock.value = 1;
  }, [entryClock]);

  // Undo (#3660): the board fades in from the one it replaces. Nothing on mount.
  const boardFade = useSharedValue(1);
  const seenUndoSeq = useRef(undoSeq);
  useEffect(() => {
    if (undoSeq === seenUndoSeq.current) return;
    seenUndoSeq.current = undoSeq;
    cancelAnimation(boardFade);
    if (reduceMotion) {
      boardFade.value = 1;
      return;
    }
    boardFade.value = UNDO_FADE_FROM;
    boardFade.value = withTiming(1, { duration: UNDO_FADE_MS, easing: Easing.out(Easing.quad) });
  }, [undoSeq, reduceMotion, boardFade]);
  const gridFadeStyle = useAnimatedStyle(() => ({ opacity: boardFade.value }));

  const handlers = useMemo(
    () =>
      state.bottles.map((_, idx) => () => {
        skipLevelIn();
        onBottleTap(idx);
      }),
    // state.bottles identity changes on every pour; keying on .length avoids
    // rebuilding all handlers when only liquid positions change. onBottleTap is
    // included so callers that wrap it in useCallback get stable handles too.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.bottles.length, onBottleTap, skipLevelIn]
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

  return (
    <View accessibilityLabel={t("a11y.boardRegion")} accessibilityRole="none" style={styles.board}>
      <Animated.View
        key={numBottles}
        testID="sort-grid"
        style={[styles.grid, { gap: rowGap }, gridFadeStyle]}
        onLayout={(e) => {
          gridOffsetRef.current = {
            x: e.nativeEvent.layout.x,
            y: e.nativeEvent.layout.y,
          };
        }}
      >
        {rows.map(({ start, count }, rowIdx) => (
          <View
            key={rowIdx}
            testID={`sort-row-${rowIdx}`}
            style={styles.gridRow}
            onLayout={(e) => {
              rowOffsetsRef.current[rowIdx] = {
                x: e.nativeEvent.layout.x,
                y: e.nativeEvent.layout.y,
              };
            }}
          >
            {state.bottles.slice(start, start + count).map((bottle, localIdx) => {
              const idx = start + localIdx;
              return (
                <View
                  key={idx}
                  testID={`bottle-cell-${idx}`}
                  style={[
                    styles.bottleCell,
                    // Cells tile the row edge to edge: the space between
                    // bottles is the cell's own margin around its centered
                    // bottle, which the bottle's hitSlop reaches (#2207).
                    { width: slotW },
                    idx === pouringFrom && ghost !== null ? styles.bottleHidden : null,
                  ]}
                  onLayout={(e) => {
                    cellLayoutsRef.current[idx] = {
                      row: rowIdx,
                      x: e.nativeEvent.layout.x,
                      y: e.nativeEvent.layout.y,
                    };
                  }}
                >
                  <BottleView
                    bottle={bottle}
                    index={idx}
                    selected={state.selectedBottleIndex === idx}
                    refusedSeq={refused?.index === idx ? refused.seq : 0}
                    undoSeq={undoSeq}
                    entryClock={playLevelIn ? entryClock : undefined}
                    entryDelayMs={levelInDelayMs(idx, numBottles)}
                    colorblindMode={colorblindMode}
                    bottleWidth={bottleW}
                    bottleHeight={bottleH}
                    hitSlop={hitSlop}
                    onTap={handlers[idx]}
                    hintTarget={idx === hintTo}
                  />
                  {idx === hintTo && (
                    <View
                      testID="hint-dst-ring"
                      style={[
                        styles.dstRing,
                        {
                          left: bottleInsetX - 4,
                          top: -4,
                          width: bottleW + 8,
                          height: bottleH + 8,
                          borderColor: colors.hintRing,
                        },
                      ]}
                      pointerEvents="none"
                      accessibilityElementsHidden
                      importantForAccessibility="no-hide-descendants"
                    />
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </Animated.View>

      {/* Ghost bottle overlay — floats above grid during pour animation.
          ghost is only set when !reduceMotion, so the extra guard is omitted. */}
      {ghost !== null && (
        <View
          testID="pour-ghost-overlay"
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {/* Destination highlight ring — glows in pour color */}
          {streamColor !== "transparent" && (
            <View
              testID="pour-dst-ring"
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
                {Array.from({ length: ghost.units }).map((_, k) => (
                  <LandedUnit
                    key={k}
                    landed={unitsLanded}
                    k={k}
                    yVb={
                      BODY_BOTTOM_VB - (ghost.dstBottleLength + k + 1) * (INNER_H_VB / BOTTLE_DEPTH)
                    }
                    unitHVb={INNER_H_VB / BOTTLE_DEPTH}
                    fill={liquidColors[ghost.pourColor]}
                  />
                ))}
              </G>
            </Svg>
          </View>
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
                  stroke={BOTTLE_STREAM_HIGHLIGHT}
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
              bottle={ghost.bottle}
              drained={unitsEmitted}
              index={ghost.bottleIndex}
              isGhost
              colorblindMode={colorblindMode}
              bottleWidth={bottleW}
              bottleHeight={bottleH}
            />
          </Animated.View>
        </View>
      )}

      {winCascade && <SortWinCascade onDone={onWinCascadeDone} height={avH} />}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Destination fill: one layer per poured unit, shown on the UI thread as it lands
// ---------------------------------------------------------------------------

function LandedUnit({
  landed,
  k,
  yVb,
  unitHVb,
  fill,
}: {
  readonly landed: SharedValue<number>;
  readonly k: number;
  readonly yVb: number;
  readonly unitHVb: number;
  readonly fill: string;
}) {
  const props = useAnimatedProps(() => ({ opacity: landed.value > k ? 1 : 0 }));
  return (
    <AnimatedG animatedProps={props}>
      <Rect x={0} y={yVb} width={VB_W} height={unitHVb + 0.5} fill={fill} />
      <Rect x={0} y={yVb} width={VB_W} height={2.5} fill={BOTTLE_LIQUID_SHEEN} />
    </AnimatedG>
  );
}

// ---------------------------------------------------------------------------
// Win cascade (#3660) — liquid-coloured pieces fall across the board when the puzzle is
// solved. The result card waits for `onDone`: the cascade's end (WIN_CASCADE_MS) or a tap.
// ---------------------------------------------------------------------------

interface CascadeProps {
  readonly onDone?: () => void;
  readonly height: number;
}

const CONFETTI_KEYS: Color[] = ["red", "orange", "green", "blue", "purple", "pink"];
const CONFETTI_PIECE = {
  width: WIN_CASCADE_PIECE_PX,
  height: WIN_CASCADE_PIECE_PX,
  borderRadius: WIN_CASCADE_PIECE_PX / 2,
} as const;

function SortWinCascade({ onDone, height }: CascadeProps) {
  const { theme } = useTheme();
  const liquidColors = LIQUID_COLORS[theme];
  const reduceMotion = useReduceMotion();
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  // Reduce Motion (also turned on mid-cascade): no cascade, the card at once.
  useEffect(() => {
    if (reduceMotion) {
      onDoneRef.current?.();
      return;
    }
    const timer = setTimeout(() => onDoneRef.current?.(), WIN_CASCADE_MS);
    return () => clearTimeout(timer);
  }, [reduceMotion]);

  if (reduceMotion) return null;

  const timing: ConfettiFallTiming = {
    fromY: -60,
    toY: Math.max(height, 300),
    staggerMs: WIN_CASCADE_STAGGER_MS,
    holdMs: WIN_CASCADE_HOLD_MS,
    fadeOutMs: WIN_CASCADE_FADE_OUT_MS,
  };
  return (
    <>
      <ConfettiFall
        testID="sort-win-cascade"
        colors={CONFETTI_KEYS.map((k) => liquidColors[k])}
        pieceStyle={CONFETTI_PIECE}
        timing={timing}
      />
      {/* A tap anywhere on the board skips the cascade. */}
      <Pressable
        testID="sort-win-cascade-skip"
        style={StyleSheet.absoluteFill}
        onPress={() => onDoneRef.current?.()}
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      />
    </>
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
    flexDirection: "column",
    alignItems: "center",
  },
  gridRow: {
    flexDirection: "row",
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
});
