/**
 * The aim guide (#3928, owner pick A "Dashed line + ghost"), drawn into the board's Skia Picture
 * on the UI thread: a thin dashed plumb line in the lid palette's ink from under the spawner
 * piece down to a dashed ghost outline of the piece where it would first touch, with a faint fill
 * in its light tone. Numbers: `MOTION.aim`; the cast: `aim.ts` `landingY`.
 *
 * Cost while aiming: one dashed line, one filled circle, one dashed circle. The landing cast is
 * cached on (aim x, frame, radius): it runs again only when one of them changes, not for the
 * dash march. The dash effects are built once per whole-px offset and cached. No blur, no
 * gradient. Reduce Motion: no march, and the guide shows and hides at once.
 */
import { PaintStyle, Skia, StrokeCap } from "@shopify/react-native-skia";
import type { SkCanvas, SkColor, SkPaint, SkPathEffect } from "@shopify/react-native-skia";
import type { CascadeLidPalette, CascadeMotionTone } from "../../../theme/theme.cascade";
import { SPAWNER, spawnerPieceRadius } from "../lidVisuals";
import { MOTION } from "../motion";
import { AIM_STATE, aimDropX, aimGuideAlpha, landingY } from "../aim";

/** The aim, as the board reads it this frame (shared values, `useBoardMotion`). */
export interface BoardAim {
  readonly state: number;
  /** The finger's world x (wall-clamped); where the piece drops. */
  readonly x: number;
  /** Ms of the motion clock since the state began. */
  readonly ms: number;
  /** Where a cancel's glide back to the ring starts. */
  readonly fromX: number;
}

interface AimCache {
  readonly paint: SkPaint;
  readonly colors: Map<string, SkColor>;
  readonly lineDashes: (SkPathEffect | null)[];
  ghostDash: SkPathEffect | null;
  castX: number;
  castR: number;
  castFrame: Float64Array | null;
  castY: number;
}

function aimCache(): AimCache {
  "worklet";
  const g = globalThis as unknown as { __cascadeAimCache?: AimCache };
  let cache = g.__cascadeAimCache;
  if (!cache) {
    cache = {
      paint: Skia.Paint(),
      colors: new Map(),
      lineDashes: [],
      ghostDash: null,
      castX: NaN,
      castR: NaN,
      castFrame: null,
      castY: 0,
    };
    g.__cascadeAimCache = cache;
  }
  return cache;
}

function paintOf(cache: AimCache, hex: string, alpha: number, strokeWidth: number): SkPaint {
  "worklet";
  let c = cache.colors.get(hex);
  if (c === undefined) {
    c = Skia.Color(hex);
    cache.colors.set(hex, c);
  }
  const p = cache.paint;
  p.reset();
  p.setAntiAlias(true);
  p.setColor(c);
  p.setAlphaf(p.getAlphaf() * alpha);
  if (strokeWidth > 0) {
    p.setStyle(PaintStyle.Stroke);
    p.setStrokeWidth(strokeWidth);
  }
  return p;
}

/** The landing centre y for this frame, from the cache when nothing it depends on changed. */
export function cachedLandingY(
  frame: Float64Array,
  radius: readonly number[],
  x: number,
  r: number
): number {
  "worklet";
  const cache = aimCache();
  if (cache.castFrame !== frame || cache.castX !== x || cache.castR !== r) {
    cache.castY = landingY(frame, radius, x, r);
    cache.castFrame = frame;
    cache.castX = x;
    cache.castR = r;
  }
  return cache.castY;
}

/**
 * The guide under the spawner piece of `tier`. `clockMs` drives the dash march. Draws nothing
 * when the aim is idle, a tap that has not become a drag, or faded out.
 */
export function drawAimGuide(
  canvas: SkCanvas,
  frame: Float64Array,
  radius: readonly number[],
  tier: number,
  aim: BoardAim | null,
  lid: CascadeLidPalette,
  tone: CascadeMotionTone | null,
  clockMs: number,
  reduceMotion: boolean
): void {
  "worklet";
  if (!aim || aim.state === AIM_STATE.idle || aim.state === AIM_STATE.pressed) return;
  const drawn = radius[tier] ?? 0;
  if (!(drawn > 0)) return;
  const alpha = aimGuideAlpha(aim.state, aim.ms, reduceMotion);
  if (alpha <= 0.001) return;
  const A = MOTION.aim;
  const cache = aimCache();
  const x = aimDropX(aim.x, drawn);
  const y = cachedLandingY(frame, radius, x, drawn);
  const top = SPAWNER.cy + spawnerPieceRadius(drawn) + A.lineGap;
  const lineEnd = y - drawn;
  if (lineEnd > top) {
    const period = A.dashOn + A.dashOff;
    const offset = reduceMotion ? 0 : Math.floor((clockMs * A.marchPxPerS) / 1000) % period;
    let dash = cache.lineDashes[offset] ?? null;
    if (!dash) {
      dash = Skia.PathEffect.MakeDash([A.dashOn, A.dashOff], -offset);
      cache.lineDashes[offset] = dash;
    }
    const line = paintOf(cache, lid.ink, A.lineAlpha * alpha, A.lineWidth);
    line.setStrokeCap(StrokeCap.Round);
    line.setPathEffect(dash);
    canvas.drawLine(x, top, x, lineEnd, line);
  }
  // The ghost only while the piece is aimed (a release's fade leaves only the line: the next
  // piece is a different size).
  if (aim.state !== AIM_STATE.aiming && aim.state !== AIM_STATE.cancelled) return;
  if (tone) canvas.drawCircle(x, y, drawn, paintOf(cache, tone.l, A.ghostFill * alpha, 0));
  if (!cache.ghostDash)
    cache.ghostDash = Skia.PathEffect.MakeDash([A.ghostDashOn, A.ghostDashOff], 0);
  const ghost = paintOf(cache, lid.ink, A.ghostAlpha * alpha, A.ghostWidth);
  ghost.setPathEffect(cache.ghostDash);
  canvas.drawCircle(x, y, drawn, ghost);
}
