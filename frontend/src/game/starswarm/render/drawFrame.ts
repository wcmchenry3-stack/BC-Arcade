/**
 * #2565 (epic #2562, phase 3): replay a `buildFrame` display list onto a Skia canvas.
 *
 * Runs as a worklet on the UI thread inside `createPicture`, so it may touch only Skia APIs, the
 * ops and the images it is handed — no React state, refs or engine imports. It makes no drawing
 * decisions: every choice (sprite vs fallback, colours, alphas, order) was made by `buildFrame`
 * on the JS thread and is tested there. This is a straight port of `renderOp` in GameCanvas.tsx,
 * the declarative path kept behind the "Legacy renderer" dev switch until phase 5.
 */
import { Skia, PaintStyle } from "@shopify/react-native-skia";
import type { SkCanvas, SkImage, SkPaint } from "@shopify/react-native-skia";
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

function shapePaint(
  paint: SkPaint,
  color: string,
  opacity: number | undefined,
  stroke: number | undefined
): SkPaint {
  "worklet";
  paint.setColor(Skia.Color(color));
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
  const paint = Skia.Paint();
  paint.setAntiAlias(true);
  const imagePaint = Skia.Paint();
  imagePaint.setAntiAlias(true);

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i]!;
    switch (op.k) {
      case "fill":
        canvas.drawColor(Skia.Color(op.color));
        break;
      case "rect":
        canvas.drawRect(
          Skia.XYWHRect(op.x, op.y, op.w, op.h),
          shapePaint(paint, op.color, op.opacity, undefined)
        );
        break;
      case "circle":
        canvas.drawCircle(op.cx, op.cy, op.r, shapePaint(paint, op.color, op.opacity, op.stroke));
        break;
      case "image": {
        const img = spriteImage(images, op.sprite, op.frame);
        if (!img) break; // buildFrame only emits loaded sprites; belt and braces
        const iw = img.width();
        const ih = img.height();
        const dst = fitRect(iw, ih, op, op.fit);
        if (op.flipX) {
          const cx = op.x + op.w / 2;
          canvas.save();
          canvas.translate(cx, 0);
          canvas.scale(-1, 1);
          canvas.translate(-cx, 0);
        }
        canvas.drawImageRect(
          img,
          Skia.XYWHRect(0, 0, iw, ih),
          Skia.XYWHRect(dst.x, dst.y, dst.w, dst.h),
          imagePaint
        );
        if (op.flipX) canvas.restore();
        break;
      }
      case "poly": {
        const pts = op.points;
        if (pts.length < 2) break;
        const path = Skia.Path.Make();
        path.moveTo(pts[0]!, pts[1]!);
        for (let j = 2; j + 1 < pts.length; j += 2) path.lineTo(pts[j]!, pts[j + 1]!);
        path.close();
        canvas.drawPath(path, shapePaint(paint, op.color, undefined, op.stroke));
        break;
      }
    }
  }
}
