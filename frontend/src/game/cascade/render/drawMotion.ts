/**
 * Cascade motion on the board (#3701): drawn into the board's Skia Picture on the UI thread, from
 * the motion events (`motionLog.ts`), their UI-thread stamps and the motion clock
 * (`useBoardMotion`). Every number comes from `motion.ts`. Nothing here runs in the physics step.
 *
 * `drawFrame` calls these in order: the squash while it draws the pieces, then the game-over dim,
 * the lid, the spawner (its arrival and the danger ring blink), and on top the merge pops, the
 * landing dust and the chain counter. With no motion (`null`), the board draws exactly as before.
 *
 * Cost (per frame, only while a moment plays): a merge pop is 14 draws (flash, ring, 12 confetti
 * dots), so 56 at the peak of a 4-chain; dust is 6 dots per landing; the counter 2 paths per glyph
 * plus up to 6 dots; the danger blink 2; game over 2. No blur, no gradient, no path built per
 * frame (the glyphs are built once, `chainGlyphs.ts`), one reused paint.
 */
import { PaintStyle, Skia, StrokeCap, StrokeJoin } from "@shopify/react-native-skia";
import type { SkCanvas, SkColor, SkPaint, SkPath, SkPathEffect } from "@shopify/react-native-skia";
import type {
  CascadeLidPalette,
  CascadeMotionThemePalette,
  CascadeMotionTone,
} from "../../../theme/theme.cascade";
import {
  FLOOR_THICKNESS,
  OVERFLOW_LINE_Y,
  WALL_THICKNESS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from "../constants";
import { LID_LINE, SPAWNER } from "../lidVisuals";
import {
  MOTION,
  chainPt,
  chainStep,
  clamp01,
  dangerBlinkOn,
  dangerDashOffset,
  easeInOutQuad,
  easeOutBack,
  easeOutCubic,
  easeOutQuart,
  gameOverDim,
  gameOverFlashOn,
  hash01,
  landSquash,
  lerp,
  progress,
  spawnerArrival,
  type SpawnerArrival,
} from "../motion";
import { MOTION_FIELD, MOTION_KIND, MOTION_SLOTS, MOTION_STRIDE, slotAge } from "../motionLog";

/** The chain counter's glyphs (`chainGlyphs.ts`): centre-line paths in a 1-high em box. */
export interface ChainGlyphs {
  readonly times: SkPath;
  readonly digits: readonly SkPath[];
  /** Advance per glyph, em. */
  readonly advance: number;
}

/** Everything the board needs to draw the motion of one frame. */
export interface BoardMotion {
  readonly events: Float64Array;
  readonly stamps: Float64Array;
  /** The motion clock, ms (UI thread). */
  readonly clock: number;
  /** The danger blink's phase, 0..1 (integrated on the UI thread). */
  readonly dangerPhase: number;
  /** The lid count, 0..1; 0 once the game is over. */
  readonly danger: number;
  readonly reduceMotion: boolean;
  /** Per tier: the art's tones (the pop, the confetti, the counter's outline). */
  readonly tones: readonly CascadeMotionTone[];
  readonly palette: CascadeMotionThemePalette;
  /** pt per world px (the board's scale): the counter is sized in pt. */
  readonly ptPerUnit: number;
  readonly glyphs: ChainGlyphs | null;
}

const BIN_X = WALL_THICKNESS;
const BIN_W = WORLD_WIDTH - 2 * WALL_THICKNESS;
const BIN_H = WORLD_HEIGHT - FLOOR_THICKNESS;
const COLOR_CACHE_MAX = 128;
/** Live landings looked at per frame (the squash scans only these). */
const MAX_LIVE_LANDS = 8;

interface MotionCache {
  readonly paint: SkPaint;
  readonly colors: Map<string, SkColor>;
  /** The marching dash, one per whole px of offset (built once each). */
  readonly dashes: (SkPathEffect | null)[];
  readonly lands: number[];
  landCount: number;
  readonly arrival: SpawnerArrival;
}

function motionCache(): MotionCache {
  "worklet";
  const g = globalThis as unknown as { __cascadeMotionCache?: MotionCache };
  let cache = g.__cascadeMotionCache;
  if (!cache) {
    cache = {
      paint: Skia.Paint(),
      colors: new Map(),
      dashes: [],
      lands: [],
      landCount: 0,
      arrival: { dy: 0, scale: 1, alpha: 1 },
    };
    g.__cascadeMotionCache = cache;
  }
  return cache;
}

function color(cache: MotionCache, hex: string): SkColor {
  "worklet";
  let c = cache.colors.get(hex);
  if (c === undefined) {
    if (cache.colors.size >= COLOR_CACHE_MAX) cache.colors.clear();
    c = Skia.Color(hex);
    cache.colors.set(hex, c);
  }
  return c;
}

function fill(cache: MotionCache, hex: string, alpha: number): SkPaint {
  "worklet";
  const p = cache.paint;
  p.reset();
  p.setAntiAlias(true);
  p.setColor(color(cache, hex));
  if (alpha !== 1) p.setAlphaf(p.getAlphaf() * clamp01(alpha));
  return p;
}

function stroke(cache: MotionCache, hex: string, alpha: number, width: number): SkPaint {
  "worklet";
  const p = fill(cache, hex, alpha);
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeCap(StrokeCap.Round);
  return p;
}

function toneOf(motion: BoardMotion, tier: number): CascadeMotionTone | null {
  "worklet";
  return motion.tones[tier] ?? null;
}

// ---- landing squash ------------------------------------------------------------------------

/** Finds this frame's landings that still squash (call once, before the pieces). */
export function collectLands(motion: BoardMotion | null): void {
  "worklet";
  const cache = motionCache();
  cache.landCount = 0;
  if (!motion || motion.reduceMotion) return;
  const ev = motion.events;
  for (let i = 0; i < MOTION_SLOTS && cache.landCount < MAX_LIVE_LANDS; i++) {
    if (ev[i * MOTION_STRIDE + MOTION_FIELD.kind] !== MOTION_KIND.land) continue;
    const age = slotAge(ev, motion.stamps, i, motion.clock);
    if (age < 0 || age >= MOTION.land.durationMs) continue;
    cache.lands[cache.landCount++] = i;
  }
}

/**
 * The squash of piece `id` this frame (positive squashes, negative stretches; 0: none). Its height
 * is drawn × (1 - a) and its width × (1 + stretchRatio × a), about its bottom.
 */
export function pieceSquash(motion: BoardMotion | null, id: number): number {
  "worklet";
  if (!motion) return 0;
  const cache = motionCache();
  const ev = motion.events;
  for (let k = 0; k < cache.landCount; k++) {
    const i = cache.lands[k]!;
    const o = i * MOTION_STRIDE;
    if (ev[o + MOTION_FIELD.id] !== id) continue;
    const age = slotAge(ev, motion.stamps, i, motion.clock);
    return landSquash(ev[o + MOTION_FIELD.tier] ?? 0, ev[o + MOTION_FIELD.aux] ?? 0, age);
  }
  return 0;
}

// ---- game over and danger ----------------------------------------------------------------------

function gameOverAge(motion: BoardMotion): number {
  "worklet";
  const ev = motion.events;
  for (let i = 0; i < MOTION_SLOTS; i++) {
    if (ev[i * MOTION_STRIDE + MOTION_FIELD.kind] !== MOTION_KIND.gameOver) continue;
    return slotAge(ev, motion.stamps, i, motion.clock);
  }
  return -1;
}

/** Game over: the pile dims under the page colour (under the lid, which flashes over it). */
export function drawGameOverDim(canvas: SkCanvas, motion: BoardMotion | null): void {
  "worklet";
  if (!motion) return;
  const age = gameOverAge(motion);
  if (age < 0) return;
  const dim = gameOverDim(age, motion.reduceMotion);
  if (dim <= 0) return;
  canvas.drawRect(
    Skia.XYWHRect(BIN_X, 0, BIN_W, BIN_H),
    fill(motionCache(), motion.palette.dim, dim)
  );
}

/**
 * Over the lid line: at game over two hard flashes (Reduce Motion: a steady red line); while the
 * count runs, marching dashes in the blink ink on the blink's on-beats (Reduce Motion: none).
 */
export function drawLidMotion(
  canvas: SkCanvas,
  motion: BoardMotion | null,
  lid: CascadeLidPalette
): void {
  "worklet";
  if (!motion) return;
  const cache = motionCache();
  const age = gameOverAge(motion);
  if (age >= 0) {
    const G = MOTION.gameOver;
    if (motion.reduceMotion) {
      canvas.drawLine(
        LID_LINE.x1,
        LID_LINE.y,
        LID_LINE.x2,
        LID_LINE.y,
        stroke(cache, lid.danger, 1, LID_LINE.strokeWidth)
      );
    } else if (gameOverFlashOn(age)) {
      canvas.drawLine(
        LID_LINE.x1,
        LID_LINE.y,
        LID_LINE.x2,
        LID_LINE.y,
        stroke(cache, motion.palette.blink, 1, G.flashWidth)
      );
    }
    return;
  }
  if (motion.reduceMotion || !(motion.danger > 0) || !dangerBlinkOn(motion.dangerPhase)) return;
  const D = MOTION.danger;
  const offset = Math.floor(dangerDashOffset(motion.clock, motion.danger));
  let dash = cache.dashes[offset] ?? null;
  if (!dash) {
    dash = Skia.PathEffect.MakeDash([D.dashOn, D.dashOff], -offset);
    cache.dashes[offset] = dash;
  }
  const p = stroke(cache, motion.palette.blink, 0.9, LID_LINE.strokeWidth);
  p.setStrokeCap(StrokeCap.Butt);
  p.setPathEffect(dash);
  canvas.drawLine(LID_LINE.x1, LID_LINE.y, LID_LINE.x2, LID_LINE.y, p);
}

/** The danger blink on the spawner: an outline ring just outside the clock ring, on-beats only. */
export function drawSpawnerBlink(canvas: SkCanvas, motion: BoardMotion | null): void {
  "worklet";
  if (!motion || motion.reduceMotion || !(motion.danger > 0)) return;
  if (gameOverAge(motion) >= 0 || !dangerBlinkOn(motion.dangerPhase)) return;
  const D = MOTION.danger;
  canvas.drawCircle(
    SPAWNER.cx,
    SPAWNER.cy,
    SPAWNER.ringRadius + D.ringGap,
    stroke(motionCache(), motion.palette.blink, D.ringAlpha, D.ringWidth)
  );
}

/** The spawner piece's arrival after the latest drop (offset, scale, opacity); identity if none. */
export function spawnerMotion(motion: BoardMotion | null): SpawnerArrival {
  "worklet";
  const cache = motionCache();
  const out = cache.arrival;
  if (!motion) return spawnerArrival(-1, false, out);
  const ev = motion.events;
  let best = -1;
  let bestSeq = 0;
  for (let i = 0; i < MOTION_SLOTS; i++) {
    const o = i * MOTION_STRIDE;
    if (ev[o + MOTION_FIELD.kind] !== MOTION_KIND.drop) continue;
    const seq = ev[o + MOTION_FIELD.seq] ?? 0;
    if (seq > bestSeq) {
      bestSeq = seq;
      best = i;
    }
  }
  const age = best >= 0 ? slotAge(ev, motion.stamps, best, motion.clock) : -1;
  return spawnerArrival(age, motion.reduceMotion, out);
}

// ---- merge pop and landing dust ----------------------------------------------------------------

function drawPop(
  canvas: SkCanvas,
  cache: MotionCache,
  motion: BoardMotion,
  x: number,
  y: number,
  r: number,
  tone: CascadeMotionTone,
  id: number,
  age: number
): void {
  "worklet";
  const M = MOTION.merge;
  if (motion.reduceMotion) {
    const C = MOTION.calm;
    if (age < C.mergeFlashMs) {
      canvas.drawCircle(
        x,
        y,
        r * C.mergeFlashScale,
        fill(cache, tone.l, C.mergeFlashAlpha * (1 - age / C.mergeFlashMs))
      );
    }
    return;
  }
  if (age < M.flashMs) {
    canvas.drawCircle(
      x,
      y,
      r * 0.95,
      fill(cache, motion.palette.flash, M.flashAlpha * (1 - age / M.flashMs))
    );
  }
  const k = progress(age, 0, M.ringMs);
  if (k < 1) {
    const rr = r * lerp(1, M.ringTo, easeOutQuart(k));
    canvas.drawCircle(x, y, rr, stroke(cache, tone.b, 1, Math.max(0.1, r * M.ringWidth * (1 - k))));
  }
  const kc = progress(age, 0, M.confettiMs);
  if (kc >= 1) return;
  const alpha = 1 - easeInOutQuad(kc);
  const size = 0.6 + r / 40;
  for (let i = 0; i < M.confetti; i++) {
    const a = hash01(id, i * 3) * Math.PI * 2;
    const v = (M.confettiSpeed + hash01(id, i * 3 + 1) * M.confettiSpeedSpread) * size;
    const d = r * 0.7 + v * age;
    const px = x + Math.cos(a) * d;
    const py = y + Math.sin(a) * d + M.gravity * age * age;
    const dot = (2.5 + hash01(id, i * 3 + 2) * 2.5) * (1 - kc * 0.4);
    const hex = i % 3 === 0 ? tone.b : i % 3 === 1 ? tone.l : motion.palette.flash;
    canvas.drawCircle(px, py, dot, fill(cache, hex, alpha));
  }
}

function drawDust(
  canvas: SkCanvas,
  cache: MotionCache,
  motion: BoardMotion,
  x: number,
  y: number,
  r: number,
  id: number,
  age: number
): void {
  "worklet";
  const D = MOTION.dust;
  if (motion.reduceMotion || age >= D.durationMs) return;
  const k = age / D.durationMs;
  for (let i = 0; i < D.count; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const d = r * (0.55 + 0.6 * easeOutCubic(k)) + hash01(id, i) * 4;
    const py = y + r * 0.92 - 6 * (1 - (1 - k) * (1 - k)) * (0.5 + hash01(id, i + 7));
    const dot = (2.2 + hash01(id, i + 13) * 1.6) * (1 - k * 0.5);
    canvas.drawCircle(x + side * d, py, dot, fill(cache, motion.palette.dust, D.alpha * (1 - k)));
  }
}

/** The merge pops and the landing dust, over the pieces. */
export function drawMergeMotion(
  canvas: SkCanvas,
  motion: BoardMotion | null,
  radius: readonly number[]
): void {
  "worklet";
  if (!motion) return;
  const cache = motionCache();
  const ev = motion.events;
  for (let i = 0; i < MOTION_SLOTS; i++) {
    const o = i * MOTION_STRIDE;
    const kind = ev[o + MOTION_FIELD.kind];
    if (kind !== MOTION_KIND.merge && kind !== MOTION_KIND.land) continue;
    const age = slotAge(ev, motion.stamps, i, motion.clock);
    if (age < 0) continue;
    const tier = ev[o + MOTION_FIELD.tier] ?? 0;
    const r = radius[tier] ?? 0;
    const x = ev[o + MOTION_FIELD.x] ?? 0;
    const y = ev[o + MOTION_FIELD.y] ?? 0;
    const id = ev[o + MOTION_FIELD.id] ?? 0;
    if (kind === MOTION_KIND.land) {
      drawDust(canvas, cache, motion, x, y, r, id, age);
      continue;
    }
    const tone = toneOf(motion, tier);
    if (tone && age < MOTION.merge.confettiMs)
      drawPop(canvas, cache, motion, x, y, r, tone, id, age);
  }
}

// ---- chain counter ----------------------------------------------------------------------------

/**
 * The chain counter's state this frame: the links after the latest drop, paced one per
 * `MOTION.chain.stepMs` from the first counted link. Exported for its tests.
 */
export interface ChainView {
  /** The count shown (2, 3, …), or 0 for none. */
  n: number;
  /** Ms since the shown step began, and since the first counted link. */
  sinceStep: number;
  sinceFirst: number;
  /** The first counted link's merge point, and the newest link's tier. */
  x: number;
  y: number;
  tier: number;
}

export function chainView(motion: BoardMotion, out: ChainView): ChainView {
  "worklet";
  out.n = 0;
  const ev = motion.events;
  let dropSeq = 0;
  for (let i = 0; i < MOTION_SLOTS; i++) {
    const o = i * MOTION_STRIDE;
    if (ev[o + MOTION_FIELD.kind] === MOTION_KIND.drop)
      dropSeq = Math.max(dropSeq, ev[o + MOTION_FIELD.seq] ?? 0);
  }
  let firstSeq = Infinity;
  let first = -1;
  let links = 0;
  let lastSeq = 0;
  for (let i = 0; i < MOTION_SLOTS; i++) {
    const o = i * MOTION_STRIDE;
    if (ev[o + MOTION_FIELD.kind] !== MOTION_KIND.merge) continue;
    const seq = ev[o + MOTION_FIELD.seq] ?? 0;
    const link = ev[o + MOTION_FIELD.aux] ?? 1;
    if (seq <= dropSeq || link < 2 || slotAge(ev, motion.stamps, i, motion.clock) < 0) continue;
    if (seq < firstSeq) {
      firstSeq = seq;
      first = i;
    }
    links = Math.max(links, link);
    if (seq > lastSeq) {
      lastSeq = seq;
      out.tier = ev[o + MOTION_FIELD.tier] ?? 0;
    }
  }
  if (first < 0) return out;
  const sinceFirst = slotAge(ev, motion.stamps, first, motion.clock);
  const step = chainStep(links, sinceFirst);
  const C = MOTION.chain;
  const sinceStep = sinceFirst - step * C.stepMs;
  if (sinceStep >= C.holdMs + C.outMs) return out;
  out.n = 2 + step;
  out.sinceStep = sinceStep;
  out.sinceFirst = sinceFirst;
  out.x = ev[first * MOTION_STRIDE + MOTION_FIELD.x] ?? 0;
  out.y = ev[first * MOTION_STRIDE + MOTION_FIELD.y] ?? 0;
  return out;
}

function drawGlyphs(
  canvas: SkCanvas,
  cache: MotionCache,
  glyphs: ChainGlyphs,
  n: number,
  outline: string,
  fillHex: string,
  alpha: number
): void {
  "worklet";
  const digits = String(n);
  const count = digits.length + 1;
  const w = glyphs.advance;
  canvas.translate(-(count * w) / 2, 0);
  for (let pass = 0; pass < 2; pass++) {
    const p = stroke(cache, pass === 0 ? outline : fillHex, alpha, pass === 0 ? 0.34 : 0.17);
    p.setStrokeJoin(StrokeJoin.Round);
    canvas.save();
    canvas.drawPath(glyphs.times, p);
    for (let i = 0; i < digits.length; i++) {
      canvas.translate(w, 0);
      const g = glyphs.digits[digits.charCodeAt(i) - 48];
      if (g) canvas.drawPath(g, p);
    }
    canvas.restore();
  }
}

/** The chain counter: ×N, popping in on each paced step, over the chain's first link. */
export function drawChainCounter(canvas: SkCanvas, motion: BoardMotion | null): void {
  "worklet";
  if (!motion || !motion.glyphs || !(motion.ptPerUnit > 0)) return;
  const g = globalThis as unknown as { __cascadeChainView?: ChainView };
  const view = chainView(
    motion,
    (g.__cascadeChainView ??= { n: 0, sinceStep: 0, sinceFirst: 0, x: 0, y: 0, tier: 0 })
  );
  if (view.n < 2) return;
  const C = MOTION.chain;
  const cache = motionCache();
  const tone = toneOf(motion, view.tier);
  const outline = tone ? tone.d : motion.palette.blink;
  const em = chainPt(view.n) / motion.ptPerUnit;
  const x = Math.min(
    WORLD_WIDTH - WALL_THICKNESS - 2 * em,
    Math.max(WALL_THICKNESS + 2 * em, view.x)
  );
  const y = Math.max(OVERFLOW_LINE_Y + em, view.y - C.raisePt / motion.ptPerUnit);
  const out = progress(view.sinceStep, C.holdMs, C.holdMs + C.outMs);
  canvas.save();
  canvas.translate(x, y);
  if (motion.reduceMotion) {
    const calm = MOTION.calm;
    const alpha =
      progress(view.sinceFirst, 0, calm.chainFadeMs) *
      progress(view.sinceStep, 0, calm.chainSwapMs) *
      (1 - out);
    canvas.scale(em, em);
    drawGlyphs(canvas, cache, motion.glyphs, view.n, outline, motion.palette.flash, alpha);
    canvas.restore();
    return;
  }
  const pop = lerp(C.fromScale, 1, easeOutBack(progress(view.sinceStep, 0, C.popMs), C.overshoot));
  const exit = out <= 0 ? 1 : out < 0.35 ? 1 + 0.2 * (out / 0.35) : 1.2 * (1 - (out - 0.35) / 0.65);
  const wobble =
    (view.n % 2 === 1 ? -1 : 1) *
    C.wobbleDeg *
    Math.exp(-view.sinceStep / C.wobbleDecayMs) *
    Math.cos(view.sinceStep / 45);
  canvas.rotate(wobble, 0, 0);
  const s = em * pop * exit;
  if (s > 0.01) {
    canvas.save();
    canvas.scale(s, s);
    drawGlyphs(canvas, cache, motion.glyphs, view.n, outline, motion.palette.flash, 1);
    canvas.restore();
  }
  if (view.n >= 3 && tone) {
    const k = progress(view.sinceStep, 0, C.sparkleMs);
    if (k < 1) {
      for (let i = 0; i < Math.min(6, 2 + view.n); i++) {
        const a = hash01(view.n, i) * Math.PI * 2;
        const d = em * (1.3 + hash01(view.n, i + 9)) * (0.7 + 0.5 * k);
        canvas.drawCircle(
          Math.cos(a) * d,
          Math.sin(a) * d * 0.7,
          em * 0.09 * (1 - k),
          fill(cache, tone.l, 1 - k)
        );
      }
    }
  }
  canvas.restore();
}
