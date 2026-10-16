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
import { Skia, PaintStyle, FilterMode, MipmapMode } from "@shopify/react-native-skia";
import type { SkCanvas, SkColor, SkImage, SkPaint } from "@shopify/react-native-skia";
import type { DrawOp, SpriteKey } from "./frame";

/** Loaded sprite images by key; null while an image is still loading. */
export type DrawImages = Readonly<Record<Exclude<SpriteKey, "explosion">, SkImage | null>> & {
  readonly explosion: readonly (SkImage | null)[];
};

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

function spriteImage(images: DrawImages, sprite: SpriteKey, frame: number | undefined) {
  "worklet";
  return sprite === "explosion" ? (images.explosion[frame ?? 0] ?? null) : images[sprite];
}

interface DrawCache {
  readonly paint: SkPaint;
  readonly imagePaint: SkPaint;
  /** Packed colour → Skia colour. */
  readonly colors: Map<number, SkColor>;
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
    cache = { paint, imagePaint, colors: new Map() };
    g.__starswarmDrawCache = cache;
  }
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
        const img = spriteImage(images, op.sprite, op.frame);
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
          imagePaint
        );
        if (op.flipX) canvas.restore();
        if (op.rotate) canvas.restore();
        break;
      }
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
