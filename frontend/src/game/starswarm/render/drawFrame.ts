/**
 * #2565 (epic #2562, phase 3): replay a `buildFrame` display list onto a Skia canvas.
 *
 * Runs as a worklet on the UI thread inside `createPicture`, so it may touch only Skia APIs, the
 * ops and the images it is handed — no React state, refs or engine imports. It makes no drawing
 * decisions: every choice (sprite vs fallback, colours, alphas, order) was made by `buildFrame`
 * on the JS thread and is tested there. It began as a straight port of the phase-2 declarative
 * renderer, which phase 5 (#2567) removed once the Picture path was measured on device.
 *
 * #2963: colours arrive packed (`0xAARRGGBB`), so `Skia.Color` never parses a string, and the
 * converted colours and the two paints live in a small per-runtime cache (`drawCache`) instead
 * of being rebuilt for every op of every frame.
 */
import {
  Skia,
  PaintStyle,
  FilterMode,
  MipmapMode,
  BlendMode,
  TileMode,
} from "@shopify/react-native-skia";
import type { SkCanvas, SkColor, SkImage, SkPaint } from "@shopify/react-native-skia";
import type { DrawOp, SpriteKey } from "./frame";
import { ROCK_TINT_MATRICES } from "./rockTint";
import { ARMOUR_OUTLINE, SHIP_ART_SCALE } from "./ship";
import type { ShipSpriteKey } from "./ship";

/** Loaded sprite images by key; null while an image is still loading. */
export type DrawImages = Readonly<Record<SpriteKey, SkImage | null>>;

export interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * Where an image of `imgW × imgH` lands in the op's rect. "fill" stretches to the rect; "contain"
 * is Skia's declarative default — scale to fit, keep the aspect ratio, centre in the rect.
 */
export function fitRect(imgW: number, imgH: number, dst: Box, fit: "fill" | "contain"): Box {
  "worklet";
  if (fit === "fill" || imgW <= 0 || imgH <= 0) return dst;
  const s = Math.min(dst.w / imgW, dst.h / imgH);
  const w = imgW * s;
  const h = imgH * s;
  return { x: dst.x + (dst.w - w) / 2, y: dst.y + (dst.h - h) / 2, w, h };
}

interface DrawCache {
  readonly paint: SkPaint;
  readonly imagePaint: SkPaint;
  /** Packed colour → Skia colour. */
  readonly colors: Map<number, SkColor>;
  /** #3592: the armour outline's layer paints (image filter: dilate, tint, blur), by level, made on first use. */
  readonly outlines: (SkPaint | undefined)[];
  /**
   * #3592: the armour outline glows by `shipGlowKey`, each a snapshot of the layers run through
   * the outline filter once. `null` is a build that failed (kept so it is not retried each frame);
   * a slot is absent until every layer of its stack has loaded. At most 3 ships x 3 x 3, and only
   * hull 1 and 2 ever fill one.
   */
  readonly glows: Map<number, SkImage | null>;
  /**
   * #3596: one image paint per rock palette, carrying that palette's tint (a colour-matrix
   * filter), made on first use. At most `ROCK_PALETTES.length` (3) ever exist.
   */
  readonly tints: (SkPaint | undefined)[];
}

/** Distinct colours kept before the cache starts over (fading alphas add a few per frame). */
const COLOR_CACHE_MAX = 256;

/**
 * #2963: the paints and converted colours, made once per JS runtime and kept on that runtime's
 * `globalThis`. A module-level variable would not do: module state is not shared across
 * runtimes, and what a worklet closes over reaches the UI runtime as a (frozen, in dev) copy, so
 * a cache written there is not reliably there next frame. `globalThis` is never captured — the
 * worklets plugin treats it as a global, so inside a worklet it is the UI runtime's own global,
 * which lives as long as the runtime. Each runtime that runs `drawFrame` (the UI thread in the
 * app, the JS thread in tests) keeps its own cache. A cached paint is safe to reuse: a Picture
 * records a copy of the paint with each draw call, and every op below sets the colour, alpha and
 * style it draws with.
 */
function drawCache(): DrawCache {
  "worklet";
  const g = globalThis as unknown as { __starswarmDrawCache?: DrawCache };
  let cache = g.__starswarmDrawCache;
  if (!cache) {
    const paint = Skia.Paint();
    paint.setAntiAlias(true);
    const imagePaint = Skia.Paint();
    imagePaint.setAntiAlias(true);
    cache = { paint, imagePaint, colors: new Map(), outlines: [], glows: new Map(), tints: [] };
    g.__starswarmDrawCache = cache;
  }
  // A cache made by an older bundle (dev hot reload) has no `tints` yet
  if (!cache.tints) (cache as { tints: (SkPaint | undefined)[] }).tints = [];
  return cache;
}

/** A packed colour as a Skia colour, converted once per distinct value. */
function skColor(cache: DrawCache, color: number): SkColor {
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
 * #3592: the paint a saved layer is restored with to build the armour outline: it dilates the
 * layer's silhouette, tints it armour blue and blurs it, so what is drawn is a blue glow shaped
 * like the ship. The ship is drawn over it, which hides the part that falls inside the hull.
 * The glow is made on a surface at the sprites' own resolution, so the game-px numbers are scaled
 * by `SHIP_ART_SCALE`. Built once per level and kept in the draw cache.
 */
function outlinePaint(cache: DrawCache, level: 1 | 2): SkPaint {
  "worklet";
  let paint = cache.outlines[level];
  if (!paint) {
    const o = ARMOUR_OUTLINE[level];
    const grow = o.grow * SHIP_ART_SCALE;
    const sigma = o.sigma * SHIP_ART_SCALE;
    const dilated = Skia.ImageFilter.MakeDilate(grow, grow, null);
    const tint = Skia.ColorFilter.MakeBlend(skColor(cache, o.color), BlendMode.SrcIn);
    const tinted = Skia.ImageFilter.MakeColorFilter(tint, dilated);
    paint = Skia.Paint();
    paint.setImageFilter(Skia.ImageFilter.MakeBlur(sigma, sigma, TileMode.Decal, tinted));
    cache.outlines[level] = paint;
  }
  return paint;
}

/**
 * #3596: the image paint that tints a neutral rock into palette `i` (`rockTint.ts`): a colour
 * matrix filter, built once per palette and kept in the draw cache, so a frame only draws.
 */
function rockTintPaint(cache: DrawCache, i: number): SkPaint {
  "worklet";
  let paint = cache.tints[i];
  if (!paint) {
    const matrix = ROCK_TINT_MATRICES[i] ?? ROCK_TINT_MATRICES[0]!;
    paint = Skia.Paint();
    paint.setAntiAlias(true);
    paint.setColorFilter(Skia.ColorFilter.MakeMatrix(matrix as number[]));
    cache.tints[i] = paint;
  }
  return paint;
}

function drawShipLayers(
  canvas: SkCanvas,
  layers: readonly ShipSpriteKey[],
  images: DrawImages,
  imagePaint: SkPaint,
  dst: Box
): void {
  "worklet";
  for (let i = 0; i < layers.length; i++) {
    const img = images[layers[i]!] as SkImage | null;
    if (!img) continue; // a layer that has not loaded yet
    canvas.drawImageRectOptions(
      img,
      Skia.XYWHRect(0, 0, img.width(), img.height()),
      Skia.XYWHRect(dst.x, dst.y, dst.w, dst.h),
      FilterMode.Linear,
      MipmapMode.None,
      imagePaint
    );
  }
}

/**
 * #3592: the armour outline glow of a ship op, built the first time it is needed and then kept.
 * The layers are drawn through the outline filter onto a small offscreen surface (the layers'
 * own size, the margin included) and the surface is snapshotted, so a frame only draws the
 * snapshot. This is the one point on native that can build it: the images are only usable on the
 * UI thread's runtime, which is where `createPicture` runs this. It costs one small filter pass
 * per combination (at most nine per ship, 27 slots in all), not per frame. Returns null, building nothing, while a
 * layer of the stack has not loaded yet, so a late-loading image gets its glow when it arrives.
 */
function shipGlowImage(
  cache: DrawCache,
  op: Extract<DrawOp, { k: "ship" }>,
  images: DrawImages
): SkImage | null {
  "worklet";
  const key = op.outlineKey;
  if (key === undefined || op.outline === undefined) return null;
  const hit = cache.glows.get(key);
  if (hit !== undefined) return hit;
  const layers = op.sprites;
  let first: SkImage | null = null;
  for (let i = 0; i < layers.length; i++) {
    const img = images[layers[i]!] as SkImage | null;
    if (!img) return null;
    if (!first) first = img;
  }
  if (!first) return null;
  const w = first.width();
  const h = first.height();
  let glow: SkImage | null = null;
  // A build that throws is cached as "no glow" too: the ship draws without it rather than the
  // throw repeating every frame and the outer catch dropping the rest of each frame
  try {
    const surface = Skia.Surface.Make(w, h);
    if (surface) {
      try {
        const canvas = surface.getCanvas();
        const full = { x: 0, y: 0, w, h };
        canvas.saveLayer(outlinePaint(cache, op.outline), Skia.XYWHRect(0, 0, w, h));
        drawShipLayers(canvas, layers, images, cache.imagePaint, full);
        canvas.restore();
        surface.flush();
        glow = surface.makeImageSnapshot();
      } finally {
        surface.dispose();
      }
    }
  } catch {
    glow = null;
  }
  cache.glows.set(key, glow);
  return glow;
}

function shapePaint(
  cache: DrawCache,
  color: number,
  opacity: number | undefined,
  stroke: number | undefined
): SkPaint {
  "worklet";
  const paint = cache.paint;
  paint.setColor(skColor(cache, color));
  // An op's opacity multiplies the colour's own alpha, as the declarative `opacity` prop does
  if (opacity !== undefined) paint.setAlphaf(paint.getAlphaf() * opacity);
  if (stroke !== undefined) {
    paint.setStyle(PaintStyle.Stroke);
    paint.setStrokeWidth(stroke);
  } else {
    paint.setStyle(PaintStyle.Fill);
  }
  return paint;
}

/** Draw the whole display list, back to front. */
export function drawFrame(canvas: SkCanvas, ops: readonly DrawOp[], images: DrawImages): void {
  "worklet";
  const cache = drawCache();
  const imagePaint = cache.imagePaint;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    switch (op.k) {
      case "fill":
        canvas.drawColor(skColor(cache, op.color));
        break;
      case "rect":
        canvas.drawRect(
          Skia.XYWHRect(op.x, op.y, op.w, op.h),
          shapePaint(cache, op.color, op.opacity, undefined)
        );
        break;
      case "circle":
        canvas.drawCircle(op.cx, op.cy, op.r, shapePaint(cache, op.color, op.opacity, op.stroke));
        break;
      case "image": {
        const img = images[op.sprite];
        if (!img) break; // buildFrame only emits loaded sprites; belt and braces
        const iw = img.width();
        const ih = img.height();
        const dst = fitRect(iw, ih, op, op.fit);
        // #2573: rotate about the op's rect centre — Skia's canvas.rotate(degrees, px, py) pivots
        // directly, so no manual translate/rotate/translate is needed (unlike the flipX mirror
        // below, which has no built-in equivalent).
        if (op.rotate) {
          canvas.save();
          canvas.rotate((op.rotate * 180) / Math.PI, op.x + op.w / 2, op.y + op.h / 2);
        }
        if (op.flipX) {
          const cx = op.x + op.w / 2;
          canvas.save();
          canvas.translate(cx, 0);
          canvas.scale(-1, 1);
          canvas.translate(-cx, 0);
        }
        // Linear filtering, no mipmaps — what the declarative <Image> uses by default. Plain
        // drawImageRect would sample nearest-neighbour, and every sprite here is drawn smaller
        // than its source, so it would look jagged and shimmer in motion.
        canvas.drawImageRectOptions(
          img,
          Skia.XYWHRect(0, 0, iw, ih),
          Skia.XYWHRect(dst.x, dst.y, dst.w, dst.h),
          FilterMode.Linear,
          MipmapMode.None,
          op.tint !== undefined ? rockTintPaint(cache, op.tint) : imagePaint
        );
        if (op.flipX) canvas.restore();
        if (op.rotate) canvas.restore();
        break;
      }
      case "ship": {
        // #3592: the outline first (one draw of the cached glow), then the layers over it
        if (op.outline) {
          const glow = shipGlowImage(cache, op, images);
          if (glow) {
            canvas.drawImageRectOptions(
              glow,
              Skia.XYWHRect(0, 0, glow.width(), glow.height()),
              Skia.XYWHRect(op.x, op.y, op.w, op.h),
              FilterMode.Linear,
              MipmapMode.None,
              imagePaint
            );
          }
        }
        drawShipLayers(canvas, op.sprites, images, imagePaint, op);
        break;
      }
      case "line":
        // #3597: no path to build or dispose, unlike a 2-point poly
        canvas.drawLine(
          op.x0,
          op.y0,
          op.x1,
          op.y1,
          shapePaint(cache, op.color, undefined, op.stroke)
        );
        break;
      case "poly": {
        const pts = op.points;
        if (pts.length < 2) break;
        // Skia 2.14: SkPath is immutable; geometry is built through SkPathBuilder.
        const builder = Skia.PathBuilder.Make();
        builder.moveTo(pts[0]!, pts[1]!);
        for (let j = 2; j + 1 < pts.length; j += 2) builder.lineTo(pts[j]!, pts[j + 1]!);
        builder.close();
        const path = builder.detach();
        canvas.drawPath(path, shapePaint(cache, op.color, undefined, op.stroke));
        path.dispose(); // #2963: the Picture holds its own copy; free the native path now
        builder.dispose();
        break;
      }
    }
  }
}
