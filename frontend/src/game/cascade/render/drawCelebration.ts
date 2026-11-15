/**
 * #3699: the win celebration, drawn over the board (`drawFrame.ts`) on the UI thread inside the
 * board's Picture (`components/cascade/CascadeBoard`). Owner pick: proposal A "Spotlight" with
 * proposal C's cheering face; the timeline is `../celebration.ts`.
 *
 * Clipped to the bin's cavity. Back to front: the dim over the pile, the twinkles, then around the capstone the sun rays
 * (Fruits) or the galaxy swirl (Cosmos), the glow and the gold ring, and the capstone itself,
 * risen to the centre, with its cheering face. The board draws every piece but the capstone
 * underneath (`drawFrame`'s `hideTier`), so the capstone is above the dim.
 *
 * Cost per frame, at most (Fruits / Cosmos): 1 dim rect, up to 26 twinkles (only those lit at `t`
 * are drawn: at most about 21), 12 rays / 90 swirl dots, 1 glow, 1 ring and 3-4 images; measured
 * at most 39 / 117 draws on top of the board (`drawCelebration.test.ts`). Nothing is allocated per frame: the paths,
 * shaders, rects and tables are built once at the win (`celebrationStyle.ts`), and the paint and
 * pose are reused (a per-runtime cache on `globalThis`, as `drawFrame`'s). No blur: the glow is
 * a radial gradient (#3641).
 */
import { ClipOp, FilterMode, MipmapMode, PaintStyle, Skia } from "@shopify/react-native-skia";
import type {
  SkCanvas,
  SkColor,
  SkImage,
  SkPaint,
  SkPath,
  SkRect,
  SkShader,
} from "@shopify/react-native-skia";
import {
  CELEBRATION_TARGET,
  RAY_COUNT,
  SWIRL_STRIDE,
  TWINKLE_STRIDE,
  celebrationPose,
  createCelebrationPose,
  twinkleAlpha,
  type CelebrationPose,
} from "../celebration";
import { FRAME_HEADER, FRAME_STRIDE, HEADER_FIELD, PIECE_FIELD } from "./frame";

/** One of the capstone's bitmaps, with its source rect and where it lands around the centre. */
export interface CelebrationImage {
  readonly image: SkImage;
  readonly src: SkRect;
  readonly dst: SkRect;
}

/** What the celebration draws with, built once at the win (`celebrationStyle.ts`). */
export interface CelebrationStyle {
  /** Sun rays (Fruits) or the galaxy swirl (Cosmos). */
  readonly kind: "rays" | "swirl";
  readonly reduceMotion: boolean;
  /** The capstone's tier and its drawn radius (world units). */
  readonly tier: number;
  readonly radius: number;
  /** The capstone's layers (null where they could not be drawn: a placeholder circle). */
  readonly body: CelebrationImage | null;
  readonly light: CelebrationImage | null;
  readonly top: CelebrationImage | null;
  readonly cheer: CelebrationImage | null;
  readonly placeholder: string;
  /** `#rrggbb` colours (`CASCADE_CELEBRATION`). */
  readonly dim: string;
  readonly ring: string;
  readonly rays: string;
  readonly glow: string;
  readonly sparkle: string;
  /** The bin's cavity: what the dim covers. */
  readonly dimRect: SkRect;
  /** Unit-radius radial gradients around (0, 0): the halo, and the rays' fade. */
  readonly glowShader: SkShader;
  readonly rayShader: SkShader;
  /** One ray, from (0, 0) out to radius 1; a four-point sparkle of radius 1. */
  readonly rayPath: SkPath;
  readonly sparklePath: SkPath;
  /** `celebration.ts`'s `twinkleTable()` and `swirlTable()`. */
  readonly twinkles: Float64Array;
  readonly swirl: Float64Array;
}

/** The ring's stroke (world units). */
const RING_WIDTH = 4;
const RING_OPACITY = 0.9;
/** Rays reach this far out, glow this far, in ring radii. */
const RAY_REACH = 2.1;
const GLOW_REACH = 1.5;
/** Colours kept before the cache starts over (the set is small and fixed). */
const COLOR_CACHE_MAX = 32;

interface CelebrationCache {
  readonly paint: SkPaint;
  readonly colors: Map<string, SkColor>;
  readonly pose: CelebrationPose;
}

/** The paint, colours and pose, made once per JS runtime. */
function celebrationCache(): CelebrationCache {
  "worklet";
  const g = globalThis as unknown as { __cascadeCelebrationCache?: CelebrationCache };
  let cache = g.__cascadeCelebrationCache;
  if (!cache) {
    cache = { paint: Skia.Paint(), colors: new Map(), pose: createCelebrationPose() };
    g.__cascadeCelebrationCache = cache;
  }
  return cache;
}

/** The reused paint, reset, anti-aliased, `color` at `alpha` (no colour: black, for images). */
function paintOf(cache: CelebrationCache, color: string | null, alpha: number): SkPaint {
  "worklet";
  const paint = cache.paint;
  paint.reset();
  paint.setAntiAlias(true);
  if (color !== null) {
    let c = cache.colors.get(color);
    if (c === undefined) {
      if (cache.colors.size >= COLOR_CACHE_MAX) cache.colors.clear();
      c = Skia.Color(color);
      cache.colors.set(color, c);
    }
    paint.setColor(c);
  }
  paint.setAlphaf(alpha);
  return paint;
}

function drawLayerImage(canvas: SkCanvas, layer: CelebrationImage, paint: SkPaint): void {
  "worklet";
  canvas.drawImageRectOptions(
    layer.image,
    layer.src,
    layer.dst,
    FilterMode.Linear,
    MipmapMode.None,
    paint
  );
}

/** The capstone at (x, y), `size` times its drawn size, turned `angle` rad, `cheer` of its face. */
function drawCapstone(
  canvas: SkCanvas,
  cache: CelebrationCache,
  style: CelebrationStyle,
  x: number,
  y: number,
  size: number,
  angle: number,
  cheer: number
): void {
  "worklet";
  const { body, light, top } = style;
  if (!body || !light || !top) {
    canvas.drawCircle(x, y, style.radius * size, paintOf(cache, style.placeholder, 1));
    return;
  }
  const cheerLayer = style.cheer;
  const faceShown = cheerLayer ? cheer : 0;
  const deg = (angle * 180) / Math.PI;
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(size, size);
  canvas.rotate(deg, 0, 0);
  const opaque = paintOf(cache, null, 1);
  drawLayerImage(canvas, body, opaque);
  canvas.rotate(-deg, 0, 0);
  drawLayerImage(canvas, light, opaque);
  canvas.rotate(deg, 0, 0);
  if (faceShown < 1) drawLayerImage(canvas, top, paintOf(cache, null, 1 - faceShown));
  if (cheerLayer && faceShown > 0) {
    drawLayerImage(canvas, cheerLayer, paintOf(cache, null, faceShown));
  }
  canvas.restore();
}

/** The twinkles over the dimmed pile: one four-point star each, while lit. */
function drawTwinkles(
  canvas: SkCanvas,
  cache: CelebrationCache,
  style: CelebrationStyle,
  t: number,
  fade: number
): void {
  "worklet";
  const tw = style.twinkles;
  const n = tw.length / TWINKLE_STRIDE;
  for (let i = 0; i < n; i++) {
    const o = i * TWINKLE_STRIDE;
    const a = twinkleAlpha(t, tw[o + 2]!, fade);
    if (a <= 0.01) continue;
    const s = tw[o + 3]!;
    canvas.save();
    canvas.translate(tw[o]!, tw[o + 1]!);
    canvas.scale(s, s);
    canvas.drawPath(style.sparklePath, paintOf(cache, style.sparkle, a));
    canvas.restore();
  }
}

/** The sun rays (Fruits), turning slowly behind the capstone, `reach` world units long. */
function drawRays(
  canvas: SkCanvas,
  cache: CelebrationCache,
  style: CelebrationStyle,
  x: number,
  y: number,
  reach: number,
  spin: number,
  alpha: number
): void {
  "worklet";
  const paint = paintOf(cache, null, alpha);
  paint.setShader(style.rayShader);
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate((spin * 180) / Math.PI, 0, 0);
  canvas.scale(reach, reach);
  const step = 360 / RAY_COUNT;
  for (let i = 0; i < RAY_COUNT; i++) {
    canvas.drawPath(style.rayPath, paint);
    canvas.rotate(step, 0, 0);
  }
  canvas.restore();
}

/** The galaxy swirl (Cosmos): three arms of star dots, turning around the capstone. */
function drawSwirl(
  canvas: SkCanvas,
  cache: CelebrationCache,
  style: CelebrationStyle,
  x: number,
  y: number,
  ring: number,
  spin: number,
  alpha: number
): void {
  "worklet";
  const sw = style.swirl;
  const n = sw.length / SWIRL_STRIDE;
  const third = (Math.PI * 2) / 3;
  for (let i = 0; i < n; i++) {
    const o = i * SWIRL_STRIDE;
    const u = sw[o + 1]!;
    const rad = ring * (0.7 + u * 1.5);
    const an = spin * 2.2 + sw[o]! * third + u * 3.2 + sw[o + 2]!;
    const color = u < 0.4 ? style.rays : u < 0.75 ? style.glow : style.sparkle;
    canvas.drawCircle(
      x + Math.cos(an) * rad,
      y + Math.sin(an) * rad * 0.82,
      sw[o + 3]!,
      paintOf(cache, color, alpha * (1 - u * 0.6))
    );
  }
}

/** The celebration, inside the bin's cavity (see `drawCelebration`). */
function drawSpotlight(
  canvas: SkCanvas,
  cache: CelebrationCache,
  pose: CelebrationPose,
  frame: Float64Array,
  style: CelebrationStyle,
  t: number
): void {
  "worklet";
  canvas.drawRect(style.dimRect, paintOf(cache, style.dim, pose.dim));
  if (pose.twinkle > 0) drawTwinkles(canvas, cache, style, t, pose.twinkle);

  // The capstone: the frame's piece of its tier (there is one; making it ended play).
  const n = frame[HEADER_FIELD.count] ?? 0;
  let o = -1;
  for (let i = 0; i < n; i++) {
    const at = FRAME_HEADER + i * FRAME_STRIDE;
    if (frame[at + PIECE_FIELD.tier] === style.tier) {
      o = at;
      break;
    }
  }
  if (o < 0) return;
  const px = frame[o + PIECE_FIELD.x] ?? 0;
  const py = frame[o + PIECE_FIELD.y] ?? 0;
  const grown = frame[o + PIECE_FIELD.scale] ?? 1;
  const angle = frame[o + PIECE_FIELD.angle] ?? 0;
  const x = px + (CELEBRATION_TARGET.x - px) * pose.lift;
  const y = py + (CELEBRATION_TARGET.y - py) * pose.lift;
  const size = grown * pose.scale;
  const ring = style.radius * size * pose.ring;

  if (pose.glow > 0) {
    if (pose.rays > 0) {
      if (style.kind === "rays") {
        drawRays(canvas, cache, style, x, y, ring * RAY_REACH, pose.spin, pose.rays);
      } else {
        drawSwirl(canvas, cache, style, x, y, ring, pose.spin, pose.rays);
      }
    }
    const glow = paintOf(cache, null, pose.glow);
    glow.setShader(style.glowShader);
    canvas.save();
    canvas.translate(x, y);
    canvas.scale(ring * GLOW_REACH, ring * GLOW_REACH);
    canvas.drawCircle(0, 0, 1, glow);
    canvas.restore();
    const stroke = paintOf(cache, style.ring, pose.glow * RING_OPACITY);
    stroke.setStyle(PaintStyle.Stroke);
    stroke.setStrokeWidth(RING_WIDTH);
    canvas.drawCircle(x, y, ring, stroke);
  }
  drawCapstone(canvas, cache, style, x, y, size, angle * (1 - pose.upright), pose.cheer);
}

/**
 * The celebration at `t` ms after the win, over a board drawn by `drawFrame` with the capstone
 * hidden, clipped to the bin's cavity (the rays and the swirl reach past the capstone). Draws
 * nothing before the celebration starts (`celebrationPose`).
 */
export function drawCelebration(
  canvas: SkCanvas,
  frame: Float64Array,
  style: CelebrationStyle,
  t: number
): void {
  "worklet";
  const cache = celebrationCache();
  const pose = cache.pose;
  if (!celebrationPose(t, style.reduceMotion, pose)) return;
  canvas.save();
  canvas.clipRect(style.dimRect, ClipOp.Intersect, true);
  drawSpotlight(canvas, cache, pose, frame, style, t);
  canvas.restore();
}
