/**
 * #3698: the shared "pen" of Cascade's code-drawn pieces, in the kawaii glossy sticker style the
 * owner picked (2026-11-14): a glossy gradient body, a darker rim inside the edge, outlined
 * features, two specular dots and a face (fruits open eyes, cosmos closed eyes and blush).
 *
 * A piece (`fruits.ts`, `cosmos.ts`) says WHAT is on it, in unit space: centre (0, 0), collider
 * radius 1, y down. The pen says HOW it is painted. Only paths, linear and radial gradients,
 * circles, ovals and round-capped strokes: no mask filters, no blur, no bitmaps. Everything the
 * body draws is clipped to the unit circle, so the piece fills its collider exactly; only a
 * piece's `back` and `front` draw outside it (the owner-approved overhangs, bounded by `box`).
 *
 * A piece is drawn in three layers so the board can rotate it with the physics while its light
 * stays put (`sprites.ts`):
 *   - `body`  (rotates): back overhangs, then the clipped body and its features;
 *   - `light` (upright): the rim shade, gloss blob and specular dots, clipped to the circle, so
 *              the highlight stays top-left however the piece rolls;
 *   - `top`   (rotates): the face (clipped) and the front overhangs.
 * The face rolls with the body, as a sticker on the piece would: an upright face over a rolling
 * body slides across its features (the coconut's eyes, the strawberry-like seeds) and reads as
 * pasted on.
 *
 * Runs on the JS thread only (the board draws cached bitmaps of it on the UI thread), so none of
 * this is a worklet.
 */
import {
  ClipOp,
  PaintStyle,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
} from "@shopify/react-native-skia";
import type { SkCanvas, SkColor, SkPaint, SkPath, SkPathBuilder } from "@shopify/react-native-skia";
import { CASCADE_ART, type CascadeTone } from "../../../theme/theme.cascade";

export type Tone = CascadeTone;

/** `#rrggbb` with alpha `a`, as a Skia colour. */
export function rgba(hex: string, a = 1): SkColor {
  const n = parseInt(hex.slice(1), 16);
  return new Float32Array([((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a]);
}

/** `h1` mixed `t` of the way to `h2`, rounded to 8 bits a channel as the approved renders were. */
export function mix(h1: string, h2: string, t: number, a = 1): SkColor {
  const x = rgba(h1);
  const y = rgba(h2);
  const c = new Float32Array(4);
  for (let i = 0; i < 3; i++) c[i] = Math.round((x[i]! + (y[i]! - x[i]!) * t) * 255) / 255;
  c[3] = a;
  return c;
}

type Pt = readonly [number, number];

/** Path builder shorthands (SVG-like letters plus the shapes the pieces share). */
export interface Shape {
  M(x: number, y: number): Shape;
  L(x: number, y: number): Shape;
  Q(a: number, b: number, x: number, y: number): Shape;
  C(a: number, b: number, c: number, d: number, x: number, y: number): Shape;
  Z(): Shape;
  circ(x: number, y: number, r: number): Shape;
  oval(x: number, y: number, rx: number, ry: number): Shape;
  /** An open elliptical arc, degrees clockwise from +x. */
  arc(x: number, y: number, rx: number, ry: number, start: number, sweep: number): Shape;
  /** A smooth closed blob through the points (Catmull-Rom). */
  blob(pts: readonly Pt[]): Shape;
  /** A plump leaf with rounded ends from (x0, y0) to (x1, y1); `w` is its half width. */
  leaf(x0: number, y0: number, x1: number, y1: number, w: number): Shape;
  /**
   * A dragonfruit bract: a flame with a rounded tip and a concave notch in its base. Base centre
   * (bx, by), half width `w`, tip (tx, ty), notch depth `k` (of the height), tip curl `c`.
   */
  bract(bx: number, by: number, w: number, tx: number, ty: number, k: number, c: number): Shape;
}

function ltrb(x: number, y: number, rx: number, ry: number) {
  return Skia.XYWHRect(x - rx, y - ry, rx * 2, ry * 2);
}

function shape(p: SkPathBuilder): Shape {
  const s: Shape = {
    M: (x, y) => (p.moveTo(x, y), s),
    L: (x, y) => (p.lineTo(x, y), s),
    Q: (a, b, x, y) => (p.quadTo(a, b, x, y), s),
    C: (a, b, c, d, x, y) => (p.cubicTo(a, b, c, d, x, y), s),
    Z: () => (p.close(), s),
    circ: (x, y, r) => (p.addCircle(x, y, r), s),
    oval: (x, y, rx, ry) => (p.addOval(ltrb(x, y, rx, ry)), s),
    arc: (x, y, rx, ry, start, sweep) => (p.addArc(ltrb(x, y, rx, ry), start, sweep), s),
    blob: (pts) => {
      const n = pts.length;
      const at = (i: number) => pts[(i + n) % n]!;
      p.moveTo(pts[0]![0], pts[0]![1]);
      for (let i = 0; i < n; i++) {
        const [x0, y0] = at(i - 1);
        const [x1, y1] = at(i);
        const [x2, y2] = at(i + 1);
        const [x3, y3] = at(i + 2);
        p.cubicTo(
          x1 + (x2 - x0) / 6,
          y1 + (y2 - y0) / 6,
          x2 - (x3 - x1) / 6,
          y2 - (y3 - y1) / 6,
          x2,
          y2
        );
      }
      p.close();
      return s;
    },
    leaf: (x0, y0, x1, y1, w) => {
      const dx = x1 - x0;
      const dy = y1 - y0;
      const l = Math.hypot(dx, dy);
      const tx = dx / l;
      const ty = dy / l;
      const nx = -ty * w;
      const ny = tx * w;
      p.moveTo(x0, y0);
      p.cubicTo(
        x0 + nx * 1.3 + tx * l * 0.2,
        y0 + ny * 1.3 + ty * l * 0.2,
        x1 + nx * 0.5 - tx * l * 0.1,
        y1 + ny * 0.5 - ty * l * 0.1,
        x1,
        y1
      );
      p.cubicTo(
        x1 - nx * 0.5 - tx * l * 0.1,
        y1 - ny * 0.5 - ty * l * 0.1,
        x0 - nx * 1.3 + tx * l * 0.2,
        y0 - ny * 1.3 + ty * l * 0.2,
        x0,
        y0
      );
      p.close();
      return s;
    },
    bract: (bx, by, w, tx, ty, k, c) => {
      const hx = tx - bx;
      const hy = ty - by;
      const L = Math.hypot(hx, hy);
      const ux = hx / L;
      const uy = hy / L;
      const nx = -uy;
      const ny = ux;
      const lx = bx - nx * w;
      const ly = by - ny * w;
      const rx = bx + nx * w;
      const ry = by + ny * w;
      const t0 = tx + nx * c;
      const t1 = ty + ny * c;
      const sx = ux * L;
      const sy = uy * L;
      p.moveTo(lx, ly);
      p.cubicTo(
        lx - nx * w * 0.1 + sx * 0.5,
        ly - ny * w * 0.1 + sy * 0.5,
        t0 - nx * w * 0.28 - sx * 0.3,
        t1 - ny * w * 0.28 - sy * 0.3,
        t0,
        t1
      );
      p.cubicTo(
        t0 + nx * w * 0.28 - sx * 0.3,
        t1 + ny * w * 0.28 - sy * 0.3,
        rx + nx * w * 0.1 + sx * 0.5,
        ry + ny * w * 0.1 + sy * 0.5,
        rx,
        ry
      );
      const q = k * 0.25;
      p.quadTo(bx + nx * w * 0.3 + sx * q, by + ny * w * 0.3 + sy * q, bx + sx * k, by + sy * k);
      p.quadTo(bx - nx * w * 0.3 + sx * q, by - ny * w * 0.3 + sy * q, lx, ly);
      p.close();
      return s;
    },
  };
  return s;
}

/** A path built with the `Shape` shorthands. */
export function P(fn: (s: Shape) => void): SkPath {
  const builder = Skia.PathBuilder.Make();
  fn(shape(builder));
  return builder.build();
}

function paint(): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  return p;
}

export function fillPaint(color: SkColor): SkPaint {
  const p = paint();
  p.setColor(color);
  return p;
}

export function strokePaint(color: SkColor, width: number): SkPaint {
  const p = fillPaint(color);
  return asStroke(p, width);
}

/** Round-capped, round-joined stroke of `width`. */
export function asStroke(p: SkPaint, width: number): SkPaint {
  p.setStyle(PaintStyle.Stroke);
  p.setStrokeWidth(width);
  p.setStrokeCap(StrokeCap.Round);
  p.setStrokeJoin(StrokeJoin.Round);
  return p;
}

export function linear(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colors: SkColor[],
  pos: number[]
): SkPaint {
  const p = paint();
  p.setShader(
    Skia.Shader.MakeLinearGradient(
      Skia.Point(x0, y0),
      Skia.Point(x1, y1),
      colors,
      pos,
      TileMode.Clamp
    )
  );
  return p;
}

export function radial(x: number, y: number, r: number, colors: SkColor[], pos: number[]): SkPaint {
  const p = paint();
  p.setShader(Skia.Shader.MakeRadialGradient(Skia.Point(x, y), r, colors, pos, TileMode.Clamp));
  return p;
}

/** What a piece description draws with. */
export interface Pen {
  readonly canvas: SkCanvas;
  /** The glossy body: the whole unit circle. */
  body(t: Tone): void;
  /** A flat patch (maria, continents, blush). */
  fill(path: SkPath, color: string, a?: number): void;
  /** A small outlined sphere inside the piece (grapes). */
  ball(x: number, y: number, r: number, t: Tone): void;
  crater(x: number, y: number, r: number, t: Tone): void;
  line(path: SkPath, color: string, width: number, a?: number): void;
  dot(x: number, y: number, r: number, color: string, a?: number): void;
  /** An overhang shape (leaf, stem, crown) with its sticker outline: never clipped. */
  over(path: SkPath, t: Tone): void;
}

export function makePen(canvas: SkCanvas): Pen {
  return {
    canvas,
    body(t) {
      canvas.drawCircle(
        0,
        0,
        1,
        radial(-0.25, -0.35, 1.35, [mix(t.l!, t.b, 0.25), rgba(t.b), rgba(t.d!)], [0, 0.55, 1])
      );
    },
    fill(path, color, a = 1) {
      canvas.drawPath(path, fillPaint(rgba(color, a)));
    },
    ball(x, y, r, t) {
      canvas.drawCircle(x, y, r, fillPaint(rgba(t.b)));
      canvas.drawCircle(x, y, r - 0.015, strokePaint(rgba(t.d!), 0.03));
      canvas.drawCircle(
        x - r * 0.38,
        y - r * 0.38,
        r * 0.2,
        fillPaint(rgba(CASCADE_ART.white, 0.7))
      );
    },
    crater(x, y, r, t) {
      canvas.drawCircle(x, y, r, fillPaint(rgba(t.d!, 0.7)));
    },
    line(path, color, width, a = 1) {
      canvas.drawPath(path, strokePaint(rgba(color, a), width));
    },
    dot(x, y, r, color, a = 1) {
      canvas.drawCircle(x, y, r, fillPaint(rgba(color, a)));
    },
    over(path, t) {
      canvas.drawPath(path, fillPaint(rgba(t.b)));
      canvas.drawPath(path, strokePaint(rgba(t.o ?? t.d!), 0.06));
    },
  };
}

/** Where the face sits and its inks. */
export interface Face {
  readonly x?: number;
  readonly y?: number;
  readonly s?: number;
  readonly blush?: string;
}

/** One piece, in unit space (see the top of this file). */
export interface PieceArt {
  readonly back?: (pen: Pen) => void;
  readonly body: (pen: Pen) => void;
  readonly front?: (pen: Pen) => void;
  readonly face: Face;
  /** Dims the gloss (emissive or dark pieces). */
  readonly gloss?: number;
  /** Dims the rim shade. */
  readonly shadow?: number;
  /**
   * Everything the piece draws, overhangs and strokes included, in unit radii:
   * [left, top, right, bottom]. The cached bitmaps are this size (`sprites.ts`), and a test
   * renders every piece and fails if a pixel lands outside it (`art.test.ts`).
   */
  readonly box: readonly [number, number, number, number];
}

/** One set's twelve pieces, by tier, and its face style. */
export interface ArtSet {
  readonly pieces: readonly PieceArt[];
  /** Per-tier face ink. */
  readonly ink: readonly string[];
  /** Cosmos sleep (closed eyes and blush); fruits look at you. */
  readonly closedEyes: boolean;
}

/** The unit circle, the collider. */
export const UNIT_BOX = [-1, -1, 1, 1] as const;

function clipUnit(canvas: SkCanvas): void {
  canvas.clipPath(
    P((s) => s.circ(0, 0, 1)),
    ClipOp.Intersect,
    true
  );
}

/** The light, upright and inside the circle: rim shade, gloss blob, two specular dots. */
function drawLight(canvas: SkCanvas, art: PieceArt): void {
  const g = art.gloss ?? 1;
  const white = CASCADE_ART.white;
  const clear = rgba(CASCADE_ART.rim, 0);
  canvas.drawCircle(
    0,
    0,
    1,
    radial(0, 0, 1, [clear, clear, rgba(CASCADE_ART.rim, 0.22 * (art.shadow ?? 1))], [0, 0.86, 1])
  );
  canvas.drawCircle(
    -0.36,
    -0.42,
    0.42,
    radial(-0.36, -0.42, 0.42, [rgba(white, 0.2 * g), rgba(white, 0)], [0, 1])
  );
  canvas.save();
  canvas.rotate(-35, -0.47, -0.62);
  canvas.drawOval(Skia.XYWHRect(-0.6, -0.68, 0.26, 0.12), fillPaint(rgba(white, 0.55 * g)));
  canvas.restore();
  canvas.drawCircle(-0.66, -0.4, 0.05, fillPaint(rgba(white, 0.5 * g)));
}

/** The face: open eyes with glints and a smile, or closed eyes with blush. */
function drawFace(canvas: SkCanvas, face: Face, ink: string, closed: boolean): void {
  const fx = face.x ?? 0;
  const fy = face.y ?? 0.05;
  const s = (face.s ?? 1) * 1.15;
  const ex = 0.36 * s;
  const er = 0.13 * s;
  const white = CASCADE_ART.white;
  const inkPaint = (w: number) => strokePaint(rgba(ink), w);
  if (!closed) {
    const blush = fillPaint(rgba(face.blush ?? CASCADE_ART.blushOpen, 0.18));
    for (const sx of [-1, 1]) {
      canvas.drawOval(
        Skia.XYWHRect(fx + sx * (ex + 0.02 * s) - 0.12 * s, fy + 0.07 * s, 0.24 * s, 0.11 * s),
        blush
      );
      const x = fx + sx * ex;
      const y = fy - 0.1 * s;
      canvas.drawCircle(x, y, er, fillPaint(rgba(ink)));
      canvas.drawCircle(x - er * 0.3, y - er * 0.36, er * 0.27, fillPaint(rgba(white)));
      canvas.drawCircle(x + er * 0.36, y + er * 0.36, er * 0.13, fillPaint(rgba(white, 0.75)));
    }
    canvas.drawPath(
      P((b) =>
        b.M(fx - 0.13 * s, fy + 0.04 * s).Q(fx, fy + 0.17 * s, fx + 0.13 * s, fy + 0.04 * s)
      ),
      inkPaint(0.045 * s)
    );
  } else {
    const blush = fillPaint(rgba(face.blush ?? CASCADE_ART.blushClosed, 0.45));
    for (const sx of [-1, 1]) {
      const x = fx + sx * ex;
      const y = fy - 0.07 * s;
      canvas.drawOval(
        Skia.XYWHRect(x - 0.15 * s + sx * 0.05 * s, y + 0.09 * s, 0.3 * s, 0.12 * s),
        blush
      );
      canvas.drawPath(
        P((b) => b.M(x - 0.1 * s, y).Q(x, y + 0.1 * s, x + 0.1 * s, y)),
        inkPaint(0.05 * s)
      );
    }
    canvas.drawPath(
      P((b) =>
        b.M(fx - 0.07 * s, fy + 0.08 * s).Q(fx, fy + 0.15 * s, fx + 0.07 * s, fy + 0.08 * s)
      ),
      inkPaint(0.04 * s)
    );
  }
}

export type Layer = "body" | "light" | "top";
export const LAYERS: readonly Layer[] = ["body", "light", "top"];

/** One layer of tier `tier` of `set`, in unit space, unrotated. */
export function drawLayer(canvas: SkCanvas, set: ArtSet, tier: number, layer: Layer): void {
  const art = set.pieces[tier];
  if (!art) return;
  const pen = makePen(canvas);
  if (layer === "body") art.back?.(pen);
  canvas.save();
  clipUnit(canvas);
  if (layer === "body") art.body(pen);
  else if (layer === "light") drawLight(canvas, art);
  else drawFace(canvas, art.face, set.ink[tier]!, set.closedEyes);
  canvas.restore();
  if (layer === "top") art.front?.(pen);
}

/** The whole piece, upright, in unit space (icons, the piece sheet). */
export function drawPiece(canvas: SkCanvas, set: ArtSet, tier: number): void {
  for (const layer of LAYERS) drawLayer(canvas, set, tier, layer);
}
