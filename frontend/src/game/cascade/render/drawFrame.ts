/**
 * #2960: draw one Cascade frame (`frame.ts`) onto a Skia canvas, in world units.
 *
 * Runs as a worklet on the UI thread inside `createPicture` (`components/cascade/CascadeBoard`),
 * so it touches only Skia, the frame buffer, the board style and the images it is handed. It is a
 * straight port of the declarative renderer it replaced (`PieceRenderer` in `CascadeScreen.tsx`
 * and the `LidLine` / `OverLidWash` / `Spawner` components of #3694): the same primitives, in the
 * same order, with the same paints, so the board looks exactly as it did. Every lid decision
 * (colours, wash, ring, ghost) still comes from the pure mappings in `lidVisuals.ts`.
 *
 * Paint handling copies what the declarative renderer does for each element: a fresh
 * anti-aliased paint, the element's colour, then its opacity multiplied into the alpha. One paint
 * is reset and reused per draw call (a Picture records a copy with each call), kept with the dash
 * effect and blur mask in a per-runtime cache on `globalThis`, as Star Swarm's `drawFrame` does.
 */
import {
  BlurStyle,
  FilterMode,
  MipmapMode,
  PaintStyle,
  Skia,
  StrokeCap,
} from "@shopify/react-native-skia";
import type {
  SkCanvas,
  SkColor,
  SkImage,
  SkMaskFilter,
  SkPaint,
  SkPathEffect,
} from "@shopify/react-native-skia";
import type { CascadeLidPalette } from "../../../theme/theme.cascade";
import {
  GHOST_FILL_OPACITY,
  GHOST_OUTLINE_OPACITY,
  LID_LINE,
  OVER_LID_OUTLINE_OPACITY,
  OVER_LID_OUTLINE_WIDTH,
  RING_TRACK_OPACITY,
  SPAWNER,
  lidColor,
  overLidWash,
  ringArcPath,
  ringState,
  spawnerPieceRadius,
} from "../lidVisuals";
import { FRAME_HEADER, FRAME_STRIDE, HEADER_FIELD, PIECE_FIELD } from "./frame";

/**
 * What the board draws with that is not per frame: per-tier sizes and placeholder colours, and
 * the lid palette. Built on the JS thread when the fruit set or the theme changes
 * (`boardStyle.ts`), so the worklet looks things up and decides nothing.
 */
export interface BoardStyle {
  /** Collider (and drawn) radius per tier; 0 for a tier the board does not draw. */
  readonly radius: readonly number[];
  /** Half the square a tier's baked sprite is drawn into: radius x bakedClipR (#3695). */
  readonly spriteHalf: readonly number[];
  /** A sprite's half-size per unit of radius (bakedClipR, or 1): sizes the spawner's sprite. */
  readonly spriteScale: readonly number[];
  /** Placeholder circle colour per tier, while a sprite has not decoded. */
  readonly color: readonly string[];
  readonly palette: CascadeLidPalette;
}

/** Decoded sprites by tier; null while one is still loading (drawn as a placeholder circle). */
export type BoardImages = readonly (SkImage | null)[];

/** The ghost outline's dash, and the ring glow's blur (the declarative props they replace). */
const GHOST_DASH = [4, 4];
const GHOST_STROKE_WIDTH = 2;
const RING_GLOW_BLUR = 4;
/** Distinct colours kept before the cache starts over (the lid and ring mix a new one as danger rises). */
const COLOR_CACHE_MAX = 256;

interface DrawCache {
  readonly paint: SkPaint;
  readonly colors: Map<string, SkColor>;
  dash: SkPathEffect | null;
  glow: SkMaskFilter | null;
}

/** The paint and converted colours, made once per JS runtime (see Star Swarm's `drawCache`). */
function drawCache(): DrawCache {
  "worklet";
  const g = globalThis as unknown as { __cascadeDrawCache?: DrawCache };
  let cache = g.__cascadeDrawCache;
  if (!cache) {
    cache = { paint: Skia.Paint(), colors: new Map(), dash: null, glow: null };
    g.__cascadeDrawCache = cache;
  }
  return cache;
}

function skColor(cache: DrawCache, color: string): SkColor {
  "worklet";
  let c = cache.colors.get(color);
  if (c === undefined) {
    if (cache.colors.size >= COLOR_CACHE_MAX) cache.colors.clear();
    c = Skia.Color(color);
    cache.colors.set(color, c);
  }
  return c;
}

/**
 * A fresh element paint, as the declarative renderer makes for each element: anti-aliased,
 * `color` (or the default black for an image), with `opacity` multiplied into the alpha.
 */
function elementPaint(cache: DrawCache, color: string | null, opacity: number): SkPaint {
  "worklet";
  const paint = cache.paint;
  paint.reset();
  paint.setAntiAlias(true);
  if (color !== null) paint.setColor(skColor(cache, color));
  if (opacity !== 1) paint.setAlphaf(paint.getAlphaf() * opacity);
  return paint;
}

function strokePaint(paint: SkPaint, width: number): SkPaint {
  "worklet";
  paint.setStyle(PaintStyle.Stroke);
  paint.setStrokeWidth(width);
  return paint;
}

/**
 * Where an image of `imgW x imgH` lands in a square box, with `fit="contain"` (the declarative
 * `<Image>`'s fit): scaled to fit, aspect kept, centred.
 */
export function containRect(
  imgW: number,
  imgH: number,
  x: number,
  y: number,
  w: number,
  h: number
): { x: number; y: number; width: number; height: number } {
  "worklet";
  if (imgW <= 0 || imgH <= 0) return { x, y, width: w, height: h };
  // The same arithmetic as Skia's own `fitRects("contain", ...)` (applyBoxFit, then inscribe),
  // so a sprite lands on exactly the pixels the declarative `<Image>` used.
  let dw: number;
  let dh: number;
  if (w / h > imgW / imgH) {
    dw = (imgW * h) / imgH;
    dh = h;
  } else {
    dw = w;
    dh = (imgH * w) / imgW;
  }
  return { x: x + (w - dw) / 2.0, y: y + (h - dh) / 2.0, width: dw, height: dh };
}

/** An image in the square of half-size `half` centred on (cx, cy), linear filtering like `<Image>`. */
function drawSprite(
  canvas: SkCanvas,
  cache: DrawCache,
  img: SkImage,
  cx: number,
  cy: number,
  half: number,
  opacity: number
): void {
  "worklet";
  const w = img.width();
  const h = img.height();
  // Through an SkRect first, as `<Image x y width height>` is: its float32 storage rounds the box
  // the same way before the fit, so the sprite samples exactly the same pixels.
  const box = Skia.XYWHRect(cx - half, cy - half, half * 2, half * 2);
  const dst = containRect(w, h, box.x, box.y, box.width, box.height);
  canvas.drawImageRectOptions(
    img,
    Skia.XYWHRect(0, 0, w, h),
    Skia.XYWHRect(dst.x, dst.y, dst.width, dst.height),
    FilterMode.Linear,
    MipmapMode.None,
    elementPaint(cache, null, opacity)
  );
}

/** The pieces, each with its over-lid wash. */
function drawPieces(
  canvas: SkCanvas,
  cache: DrawCache,
  frame: Float64Array,
  style: BoardStyle,
  images: BoardImages,
  dangerRatio: number
): void {
  "worklet";
  const n = frame[HEADER_FIELD.count] ?? 0;
  for (let i = 0; i < n; i++) {
    const o = FRAME_HEADER + i * FRAME_STRIDE;
    const tier = frame[o + PIECE_FIELD.tier] ?? -1;
    const r = style.radius[tier] ?? 0;
    if (r <= 0) continue;
    const x = frame[o + PIECE_FIELD.x] ?? 0;
    const y = frame[o + PIECE_FIELD.y] ?? 0;
    const sprite = images[tier];
    if (sprite) {
      drawSprite(canvas, cache, sprite, x, y, style.spriteHalf[tier] ?? r, 1);
    } else {
      canvas.drawCircle(x, y, r, elementPaint(cache, style.color[tier] ?? null, 1));
    }
    // The lid (#3694): a piece over the lid is washed red while the count runs.
    const wash = overLidWash({ y }, r, dangerRatio);
    if (wash) {
      const danger = style.palette.danger;
      canvas.drawCircle(x, y, r, elementPaint(cache, danger, wash.opacity));
      canvas.drawCircle(
        x,
        y,
        r - OVER_LID_OUTLINE_WIDTH / 2,
        strokePaint(elementPaint(cache, danger, OVER_LID_OUTLINE_OPACITY), OVER_LID_OUTLINE_WIDTH)
      );
    }
  }
}

/** The solid lid line, reddening as the count runs. */
function drawLidLine(canvas: SkCanvas, cache: DrawCache, style: BoardStyle, dangerRatio: number) {
  "worklet";
  const paint = elementPaint(cache, lidColor(dangerRatio, style.palette), 1);
  paint.setStrokeWidth(LID_LINE.strokeWidth);
  paint.setStrokeCap(StrokeCap.Round);
  canvas.drawLine(LID_LINE.x1, LID_LINE.y, LID_LINE.x2, LID_LINE.y, paint);
}

/** The queue's current piece above the lid, the waiting ghost, and the clock ring. */
function drawSpawner(
  canvas: SkCanvas,
  cache: DrawCache,
  style: BoardStyle,
  images: BoardImages,
  dangerRatio: number,
  canDrop: boolean,
  tier: number
): void {
  "worklet";
  const { cx, cy, ringRadius, ringWidth } = SPAWNER;
  const palette = style.palette;
  const radius = tier >= 0 ? (style.radius[tier] ?? 0) : 0;
  const hasPiece = radius > 0;
  const ring = ringState(dangerRatio, palette);
  const r = hasPiece ? spawnerPieceRadius(radius) : SPAWNER.maxPieceRadius;
  const pieceOpacity = canDrop ? 1 : GHOST_FILL_OPACITY;

  if (hasPiece) {
    const image = images[tier];
    if (image) {
      drawSprite(canvas, cache, image, cx, cy, r * (style.spriteScale[tier] ?? 1), pieceOpacity);
    } else {
      canvas.drawCircle(cx, cy, r, elementPaint(cache, style.color[tier] ?? null, pieceOpacity));
    }
  }
  if (!canDrop) {
    if (!cache.dash) cache.dash = Skia.PathEffect.MakeDash(GHOST_DASH, 0);
    const paint = strokePaint(
      elementPaint(cache, palette.ink, GHOST_OUTLINE_OPACITY),
      GHOST_STROKE_WIDTH
    );
    paint.setPathEffect(cache.dash);
    canvas.drawCircle(cx, cy, r, paint);
  }
  // The ring: a faint track, then what is left of the countdown on top.
  canvas.drawCircle(
    cx,
    cy,
    ringRadius,
    strokePaint(elementPaint(cache, palette.ink, RING_TRACK_OPACITY), ringWidth)
  );
  if (ring.remaining >= 1) {
    canvas.drawCircle(
      cx,
      cy,
      ringRadius,
      strokePaint(elementPaint(cache, ring.color, 1), ringWidth)
    );
  } else if (ring.remaining > 0) {
    const path = Skia.Path.MakeFromSVGString(ringArcPath(cx, cy, ringRadius, ring.sweepDeg));
    if (path) {
      const paint = strokePaint(elementPaint(cache, ring.color, 1), ringWidth);
      paint.setStrokeCap(StrokeCap.Round);
      if (ring.glow) {
        if (!cache.glow)
          cache.glow = Skia.MaskFilter.MakeBlur(BlurStyle.Solid, RING_GLOW_BLUR, true);
        paint.setMaskFilter(cache.glow);
      }
      canvas.drawPath(path, paint);
      path.dispose(); // the Picture holds its own copy
    }
  }
}

/** Draw the whole board, back to front: pieces (with their wash), the lid line, the spawner. */
export function drawFrame(
  canvas: SkCanvas,
  frame: Float64Array,
  style: BoardStyle,
  images: BoardImages
): void {
  "worklet";
  const cache = drawCache();
  const dangerRatio = frame[HEADER_FIELD.dangerRatio] ?? 0;
  const canDrop = (frame[HEADER_FIELD.canDrop] ?? 1) !== 0;
  const spawnerTier = frame[HEADER_FIELD.spawnerTier] ?? -1;
  drawPieces(canvas, cache, frame, style, images, dangerRatio);
  drawLidLine(canvas, cache, style, dangerRatio);
  drawSpawner(canvas, cache, style, images, dangerRatio, canDrop, spawnerTier);
}
