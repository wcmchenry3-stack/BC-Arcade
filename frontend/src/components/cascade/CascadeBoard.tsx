/**
 * The Cascade board (#2960): one Skia `Picture`, recorded on the UI thread from the frame the
 * screen's loop publishes to `frame` (a shared value; layout in `game/cascade/render/frame.ts`).
 *
 * It replaces the declarative `PieceRenderer` that lived in `CascadeScreen.tsx` and re-rendered
 * through React state every frame. React renders this component only when its props change (the
 * board's scale, the fruit set, the theme); a new frame re-records the Picture without touching
 * React. Drawing is `game/cascade/render/drawFrame.ts`; the pieces are the code-drawn art (#3698),
 * rasterised once per set and on-screen size (`game/cascade/art/sprites.ts`), over the bin
 * (`art/bin.ts`), which is the board's card: the canvas is exactly the board rect.
 *
 * The win celebration (#3699) is drawn into the same Picture, over the board: `celebration` is a
 * shared value the screen animates (ms since the win, -1 for none), so the celebration plays on
 * the UI thread with no JS loop. What it draws with (`render/celebrationStyle.ts`, including the
 * capstone rasterised bigger, with its cheering face) is built ahead, in idle time, once the board
 * holds a tier-10 piece (`prepareCelebration`), or at the win if that has not run yet; the board
 * says when it is ready (`onCelebrationReady`) so the clock starts then (`useCelebrationStyle`).
 */
import React, { useMemo } from "react";
import { PixelRatio, View } from "react-native";
import { runOnJS, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { Canvas, Group, Picture, createPicture } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../game/cascade/constants";
import { drawFrame } from "../../game/cascade/render/drawFrame";
import { drawCelebration, warmCelebration } from "../../game/cascade/render/drawCelebration";
import { CELEBRATION_START_MS } from "../../game/cascade/celebration";
import { buildBoardStyle } from "../../game/cascade/render/boardStyle";
import { pieceSprites } from "../../game/cascade/art/sprites";
import { CAPSTONE_TIER } from "../../game/cascade/tiers";
import { binPicture } from "../../game/cascade/art/bin";
import { CASCADE_MOTION, type CascadeLidPalette } from "../../theme/theme.cascade";
import { buildChainGlyphs } from "../../game/cascade/render/chainGlyphs";
import type { BoardMotionValues } from "./useBoardMotion";
import { useCelebrationStyle } from "./useCelebrationStyle";

/** A throw inside the UI-thread renderer is reported once per board, on the JS thread. */
function reportDrawError(message: string): void {
  Sentry.captureMessage(`cascade.drawFrame: ${message}`, {
    level: "error",
    tags: { subsystem: "cascade.render" },
  });
}

/** The world's size: the Picture is recorded in world units and scaled by the group. */
const WORLD_BOUNDS = { width: WORLD_WIDTH, height: WORLD_HEIGHT };

export interface CascadeBoardProps {
  /** The latest published frame (`render/frame.ts`). */
  readonly frame: { readonly value: Float64Array };
  /** World-to-screen scale (`layout.ts`). */
  readonly scale: number;
  /** The active fruit set's id: which pieces are drawn. */
  readonly setId: string;
  readonly lidPalette: CascadeLidPalette;
  /** The active theme: the bin's colours. */
  readonly theme: "light" | "dark";
  /** The board holds a tier-10 piece (#3699): build the celebration ahead, in idle time. */
  readonly prepareCelebration?: boolean;
  /** The game was won (#3699): draw the celebration. */
  readonly won?: boolean;
  /** The game is won and the celebration can be drawn (or cannot be at all): start its clock. */
  readonly onCelebrationReady?: () => void;
  /** The celebration's calm version (no rise, rotation, pulse, rays or twinkles). */
  readonly reduceMotion?: boolean;
  /** Ms since the win, animated by the screen (-1: no celebration). */
  readonly celebration?: { readonly value: number };
  /** #3701: the motion's shared values (`useBoardMotion`); absent: no motion. */
  readonly motion?: BoardMotionValues;
  /** #3928: a screen reader's double-tap (its "activate" action) drops the next piece. */
  readonly onAccessibleDrop?: () => void;
}

/** No celebration (a board without the prop). */
const NO_CELEBRATION = { value: -1 };
const NO_MOTION_EVENTS = { value: new Float64Array(0) };
/** What the Picture reads when the board has no motion (it is then not drawn). */
const NO_MOTION = {
  events: NO_MOTION_EVENTS,
  stamps: NO_MOTION_EVENTS,
  clock: NO_CELEBRATION,
  dangerPhase: NO_CELEBRATION,
  danger: NO_CELEBRATION,
  aimState: NO_CELEBRATION,
  aimX: NO_CELEBRATION,
  aimAt: NO_CELEBRATION,
  aimFromX: NO_CELEBRATION,
};

function CascadeBoard({
  frame,
  scale,
  setId,
  lidPalette,
  theme,
  prepareCelebration = false,
  won = false,
  onCelebrationReady,
  reduceMotion = false,
  celebration = NO_CELEBRATION,
  motion,
  onAccessibleDrop,
}: CascadeBoardProps) {
  const { t } = useTranslation("cascade");
  const style = useMemo(() => buildBoardStyle(lidPalette), [lidPalette]);
  // One bitmap pixel per screen pixel at each tier's ladder radius (never scaled up).
  const pxPerUnit = scale * PixelRatio.get();
  const sprites = useMemo(() => pieceSprites(setId, pxPerUnit), [setId, pxPerUnit]);
  // The win (#3699): the capstone rasterised at the celebration's size and the rest of what the
  // celebration draws, built ahead in idle time (never in a render or on the frame path).
  const celebrationStyle = useCelebrationStyle({
    setId,
    theme,
    pxPerUnit,
    fallback: sprites[CAPSTONE_TIER] ?? null,
    prepare: prepareCelebration,
    won,
    reduceMotion,
    onReady: onCelebrationReady,
  });
  // The bin (#3698): a static Picture per theme, recorded once and drawn under the pieces.
  const bin = useMemo(() => binPicture(theme), [theme]);
  // #3701: what the motion draws with, fixed until the set, theme or scale change.
  // Retried with each set of sprites while it is null (Skia not ready yet); cached once built.
  const glyphs = useMemo(() => (sprites ? buildChainGlyphs() : null), [sprites]);
  const tones = CASCADE_MOTION.tones[setId === "cosmos" ? "cosmos" : "fruits"];
  const motionPalette = CASCADE_MOTION.themes[theme];
  const {
    events,
    stamps,
    clock: motionClock,
    dangerPhase,
    danger,
    aimState,
    aimX,
    aimAt,
    aimFromX,
  } = motion ?? NO_MOTION;
  const hasMotion = motion !== undefined;
  const canvasStyle = useMemo(
    () => ({ width: WORLD_WIDTH * scale, height: WORLD_HEIGHT * scale }),
    [scale]
  );
  const transform = useMemo(() => [{ scale }], [scale]);
  const drawErrorReported = useSharedValue(false);
  const picture = useDerivedValue(() => {
    const buf = frame.value;
    const t = celebration.value;
    // The celebration once its clock is past the grow-in; before that, from the pre-warm on, its
    // invisible warm-up, so its first real frame does not stall on the GPU (#3924).
    const celeb = won && t >= CELEBRATION_START_MS ? celebrationStyle : null;
    const boardMotion = hasMotion
      ? {
          events: events.value,
          stamps: stamps.value,
          clock: motionClock.value,
          dangerPhase: dangerPhase.value,
          danger: danger.value,
          reduceMotion,
          tones,
          palette: motionPalette,
          ptPerUnit: scale,
          glyphs,
          // #3928: the aim, written by the board gesture on the UI thread.
          aim: {
            state: aimState.value,
            x: aimX.value,
            ms: motionClock.value - aimAt.value,
            fromX: aimFromX.value,
          },
        }
      : null;
    return createPicture((canvas) => {
      try {
        drawFrame(canvas, buf, style, sprites, celeb ? CAPSTONE_TIER : -1, boardMotion);
        if (celeb) drawCelebration(canvas, buf, celeb, t);
        else if (celebrationStyle) warmCelebration(canvas, celebrationStyle);
      } catch (e) {
        // Whatever drew before the throw stays; report once, never take down the UI thread.
        if (!drawErrorReported.value) {
          drawErrorReported.value = true;
          runOnJS(reportDrawError)(String(e));
        }
      }
    }, WORLD_BOUNDS);
  }, [
    style,
    sprites,
    celebrationStyle,
    won,
    hasMotion,
    reduceMotion,
    tones,
    motionPalette,
    scale,
    glyphs,
  ]);

  // The board's role and label sit on a wrapping View: on web Skia's Canvas drops accessibility
  // props, and the board must still read as an image there (#2960, CanvasKit on web).
  return (
    <View
      style={canvasStyle}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("a11y.board")}
      accessibilityHint={onAccessibleDrop ? t("a11y.boardHint") : undefined}
      accessibilityActions={
        onAccessibleDrop ? [{ name: "activate", label: t("a11y.dropPiece") }] : undefined
      }
      onAccessibilityAction={(e) => {
        if (e.nativeEvent.actionName === "activate") onAccessibleDrop?.();
      }}
    >
      <Canvas style={canvasStyle}>
        <Group transform={transform}>
          {bin && <Picture picture={bin} />}
          <Picture picture={picture} />
        </Group>
      </Canvas>
    </View>
  );
}

export default React.memo(CascadeBoard);
