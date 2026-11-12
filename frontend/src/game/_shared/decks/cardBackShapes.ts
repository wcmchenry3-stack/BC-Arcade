/**
 * The face-down card (#3740): plain shapes in screen pixels, no React.
 *
 * `CardBack.tsx` maps the shapes to react-native-svg elements and `minimal/MinimalCardFace.tsx`
 * reads `backFrameMetrics` for its View frame, so every deck's back shares one geometry. The
 * design is a function of (design, palette): a chosen back (#3429) overrides it by passing a
 * different design id or palette, with nothing else to change.
 *
 *   lattice  a margin, a saturated field, a dense diamond lattice, an inset line and, from 40 px
 *            wide, a diamond medallion. The default for Classic and Neon (owner decision, #3742).
 *   frame    the same margin, field and inset line with no pattern (Minimal).
 *
 * The margin carries the card's edge on a dark felt and the field carries it on a light one, so the
 * back reads on every table in both themes. Every design is 4-6 elements, with no filters, clip
 * paths, gradients or per-card ids: the lattice is one path whose lines are clipped to the field
 * analytically.
 */

export type CardBackDesign = "lattice" | "frame";

/** The colours a back draws. */
export interface CardBackPalette {
  /** The margin round the field. */
  readonly rim: string;
  /** The field. */
  readonly field: string;
  /** The inset line and the medallion's outline. */
  readonly line: string;
  /** The lattice. */
  readonly accent: string;
  /** The 1-px outer edge: the `border` prop, so hint and selection borders show face-down. */
  readonly edge: string;
}

export type Shape =
  | {
      readonly el: "rect";
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly rx: number;
      readonly fill?: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
    }
  | {
      readonly el: "path";
      readonly d: string;
      readonly fill?: string;
      readonly stroke?: string;
      readonly strokeWidth?: number;
      readonly opacity?: number;
    };

/** Opacity of the lattice. 0.75 of white over the teal field blends to 3.9:1 (the test blends it). */
export const LATTICE_OPACITY = 0.75;

const r1 = (v: number) => Math.round(v * 100) / 100;

/** Margin, field radius and inset-line offset for a card of width `w` and corner `radius`. */
export function backFrameMetrics(w: number, radius: number) {
  // 2 px on a 30-px Blackjack split card, 3-4 px at Solitaire/Hearts sizes, 5 at 78.
  const margin = Math.max(2, Math.min(5, Math.round(w * 0.065)));
  const fieldRadius = Math.max(1.5, radius - margin * 0.6);
  const inset = Math.max(1.5, Math.round(w * 0.05 * 2) / 2);
  const lineWidth = w >= 44 ? 1 : 0.75;
  return { margin, fieldRadius, inset, lineWidth };
}

/**
 * Lines of slope +slope and -slope, `step` px apart horizontally, clipped to the rect
 * [x0, x1] x [y0, y1]: one path, no clip path.
 */
export function latticePath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  step: number,
  slope: number
): string {
  const h = y1 - y0;
  const run = h / slope; // horizontal run of a line across the full height
  const segs: string[] = [];
  for (const dir of [1, -1]) {
    for (let c = x0 - run; c <= x1 + run; c += step) {
      const lo = Math.max(x0, Math.min(c, c + dir * run));
      const hi = Math.min(x1, Math.max(c, c + dir * run));
      if (hi - lo < 0.5) continue;
      const yAt = (x: number) => y0 + ((x - c) / (dir * run)) * h;
      segs.push(`M${r1(lo)} ${r1(yAt(lo))}L${r1(hi)} ${r1(yAt(hi))}`);
    }
  }
  return segs.join("");
}

function build(
  design: CardBackDesign,
  w: number,
  h: number,
  radius: number,
  p: CardBackPalette
): readonly Shape[] {
  const { margin: m, fieldRadius, inset: li, lineWidth } = backFrameMetrics(w, radius);
  const fw = w - 2 * m;
  const fh = h - 2 * m;
  const cx = w / 2;
  const cy = h / 2;

  const shapes: Shape[] = [
    { el: "rect", x: 0, y: 0, width: w, height: h, rx: radius, fill: p.rim },
    { el: "rect", x: m, y: m, width: fw, height: fh, rx: fieldRadius, fill: p.field },
  ];
  if (design === "lattice") {
    const step = Math.max(4, Math.round((fw / 7) * 2) / 2);
    shapes.push({
      el: "path",
      d: latticePath(m + li, m + li, m + fw - li, m + fh - li, step, 1.6),
      stroke: p.accent,
      strokeWidth: lineWidth * 0.75,
      opacity: LATTICE_OPACITY,
    });
  }
  shapes.push({
    el: "rect",
    x: m + li,
    y: m + li,
    width: fw - 2 * li,
    height: fh - 2 * li,
    rx: Math.max(1, fieldRadius - li * 0.5),
    stroke: p.line,
    strokeWidth: lineWidth,
  });
  if (design === "lattice" && w >= 40) {
    const k = Math.min(fw, fh) * 0.2;
    shapes.push({
      el: "path",
      d: `M${r1(cx)} ${r1(cy - k * 1.3)}L${r1(cx + k)} ${r1(cy)}L${r1(cx)} ${r1(cy + k * 1.3)}L${r1(cx - k)} ${r1(cy)}Z`,
      fill: p.field,
      stroke: p.line,
      strokeWidth: 1.25,
    });
  }
  // The deck's 1-px outer edge, as on the face.
  shapes.push({
    el: "rect",
    x: 0.5,
    y: 0.5,
    width: w - 1,
    height: h - 1,
    rx: radius - 0.5,
    stroke: p.edge,
    strokeWidth: 1,
  });
  return shapes;
}

export const CACHE_LIMIT = 256;
const cache = new Map<string, readonly Shape[]>();
let builds = 0;

/**
 * The back's shapes, memoised: a Solitaire deal draws ~22 backs of a few sizes, so the lattice
 * is computed once per (design, size, radius, colours). The cache is bounded: the oldest entry goes first.
 */
export function cardBackShapes(
  design: CardBackDesign,
  w: number,
  h: number,
  radius: number,
  p: CardBackPalette
): readonly Shape[] {
  const q = (v: number) => Math.round(v * 100) / 100;
  const key = JSON.stringify([
    design,
    q(w),
    q(h),
    q(radius),
    p.edge,
    p.rim,
    p.field,
    p.line,
    p.accent,
  ]);
  const hit = cache.get(key);
  if (hit) return hit;
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value as string);
  builds += 1;
  const shapes = build(design, w, h, radius, p);
  cache.set(key, shapes);
  return shapes;
}

/** @internal Test hook: how many times a back was built. */
export function cardBackBuildCount(): number {
  return builds;
}
/** @internal Test hook: empty the cache. */
export function resetCardBackCache(): void {
  cache.clear();
  builds = 0;
}
