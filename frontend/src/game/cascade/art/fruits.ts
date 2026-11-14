/**
 * #3698: the Fruits set, tiers 0-11, as small descriptions for the kawaii pen (`pen.ts`), in
 * unit space (collider radius 1, centre 0, 0, y down). `body` is clipped to the circle; `back`
 * and `front` are the only parts drawn outside it, the owner-approved overhangs (2026-11-14)
 * (measured with the outline strokes, in radii past the circle: cherry 0.52, grape and apple 0.40,
 * pineapple 0.45, peach 0.28, pumpkin 0.335, dragonfruit crown 0.475 and sides 0.12; the lemon's
 * nubs stay inside). `box` bounds each piece's ink, strokes included, within 0.03 r.
 */
import { CASCADE_ART } from "../../../theme/theme.cascade";
import {
  P,
  UNIT_BOX,
  asStroke,
  linear,
  mix,
  rgba,
  type ArtSet,
  type Pen,
  type PieceArt,
} from "./pen";

const T = CASCADE_ART.fruits;

/** A stem from (sx, sy) to (ex, ey), and an optional leaf [x0, y0, x1, y1, half width]. */
function stemLeaf(
  pen: Pen,
  sx: number,
  sy: number,
  ex: number,
  ey: number,
  leaf?: readonly [number, number, number, number, number]
): void {
  const stem = P((b) => b.M(sx, sy).Q(sx + 0.02, (sy + ey) / 2, ex, ey));
  pen.line(stem, T.stem.o, 0.2);
  pen.line(stem, T.stem.b, 0.1);
  if (leaf) {
    const [x0, y0, x1, y1, w] = leaf;
    pen.over(
      P((b) => b.leaf(x0, y0, x1, y1, w)),
      T.leaf
    );
    pen.line(
      P((b) =>
        b
          .M(x0, y0)
          .Q((x0 + x1) / 2, (y0 + y1) / 2 + 0.02, x0 + (x1 - x0) * 0.8, y0 + (y1 - y0) * 0.8)
      ),
      T.leaf.d,
      0.035,
      0.8
    );
  }
}

const cherry: PieceArt = {
  body(pen) {
    pen.body(T.cherry);
    pen.line(
      P((b) => b.M(-0.12, -0.86).Q(0.05, -0.74, 0.2, -0.86)),
      T.cherry.d,
      0.07,
      0.8
    );
  },
  front(pen) {
    stemLeaf(pen, 0.04, -0.82, 0.28, -1.42, [0.22, -1.3, 0.78, -1.2, 0.17]);
  },
  face: { y: 0.12, s: 0.95 },
  box: [-1, -1.535, 1, 1],
};

const blueberry: PieceArt = {
  body(pen) {
    pen.body(T.blue);
    const cx = 0.02;
    const cy = -0.5;
    const r = 0.27;
    const star = P((b) => {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        b.M(cx, cy).L(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.75);
      }
    });
    pen.line(star, T.blue.o, 0.13);
    pen.dot(cx, cy, 0.09, T.blueCalyx);
  },
  face: { y: 0.18, s: 0.95 },
  box: UNIT_BOX,
};

const lemon: PieceArt = {
  back(pen) {
    pen.over(
      P((b) => b.circ(0.71, -0.71, 0.24)),
      T.lemon
    );
    pen.over(
      P((b) => b.circ(-0.71, 0.71, 0.24)),
      T.lemon
    );
  },
  body(pen) {
    pen.body(T.lemon);
    pen.line(
      P((b) => b.M(0.62, -0.62).L(0.75, -0.75)),
      T.lemon.d,
      0.06,
      0.6
    );
  },
  face: { s: 0.95 },
  box: [-1, -1, 1, 1],
};

const GRAPES = [
  [-0.5, -0.5],
  [0, -0.58],
  [0.5, -0.5],
  [-0.72, 0.02],
  [-0.25, -0.08],
  [0.25, -0.08],
  [0.72, 0.02],
  [-0.45, 0.45],
  [0, 0.4],
  [0.45, 0.45],
  [-0.2, 0.85],
  [0.22, 0.85],
] as const;

const grape: PieceArt = {
  body(pen) {
    pen.body(T.grapeBg);
    for (const [x, y] of GRAPES) pen.ball(x, y, 0.3, T.grape);
  },
  front(pen) {
    stemLeaf(pen, 0, -0.85, 0.1, -1.3);
  },
  face: { y: 0.1, s: 0.9 },
  box: [-1, -1.415, 1, 1],
};

const orange: PieceArt = {
  body(pen) {
    pen.body(T.orange);
    const cx = 0;
    const cy = -0.62;
    pen.line(
      P((b) => {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * 6.283 - 1.571;
          b.M(cx, cy).L(cx + Math.cos(a) * 0.13, cy + Math.sin(a) * 0.1);
        }
      }),
      T.orangeStem,
      0.07
    );
    pen.dot(cx, cy, 0.05, T.orangeStemDot);
  },
  face: { y: 0.1 },
  box: UNIT_BOX,
};

const apple: PieceArt = {
  body(pen) {
    pen.body(T.apple);
    pen.line(
      P((b) => b.M(-0.22, -0.84).Q(0, -0.7, 0.22, -0.84)),
      T.apple.d,
      0.08,
      0.9
    );
  },
  front(pen) {
    stemLeaf(pen, 0, -0.8, 0.07, -1.3, [0.07, -1.12, 0.62, -1.3, 0.15]);
  },
  face: { y: 0.1 },
  box: [-1, -1.415, 1, 1],
};

const peach: PieceArt = {
  body(pen) {
    pen.body(T.peach);
    pen.fill(
      P((b) =>
        b.blob([
          [0.05, -0.9],
          [0.7, -0.6],
          [0.95, 0.1],
          [0.6, 0.8],
          [0.1, 0.6],
          [0.0, 0.0],
        ])
      ),
      T.peachBlush,
      0.75
    );
    pen.line(
      P((b) => b.M(0.02, -0.95).C(-0.25, -0.5, -0.25, 0.2, 0.0, 0.62)),
      T.peach.o,
      0.07,
      0.75
    );
  },
  front(pen) {
    pen.over(
      P((b) => b.leaf(-0.02, -0.92, -0.62, -1.24, 0.15)),
      T.leaf
    );
    pen.line(
      P((b) => b.M(-0.02, -0.92).L(-0.48, -1.16)),
      T.leaf.d,
      0.035,
      0.8
    );
  },
  face: { y: 0.12 },
  box: [-1, -1.295, 1, 1],
};

/** Coconut fibres: [x, y, angle] of each, fixed so every render is identical. */
const FIBRES = (() => {
  // mulberry32, seed 7 (the approved render's).
  let a = 7;
  const r = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return Array.from({ length: 9 }, () => {
    const ang = r() * 6.28;
    const d = 0.25 + r() * 0.65;
    return [Math.cos(ang) * d, Math.sin(ang) * d, ang + 1.4 + (r() - 0.5) * 0.6] as const;
  });
})();

const coconut: PieceArt = {
  body(pen) {
    pen.body(T.coconut);
    for (const [x, y, t] of FIBRES)
      pen.line(
        P((b) => b.M(x, y).L(x + Math.cos(t) * 0.2, y + Math.sin(t) * 0.2)),
        T.coconut.l,
        0.045,
        0.7
      );
    for (const [x, y] of [
      [-0.2, -0.5],
      [0.2, -0.5],
      [0, -0.22],
    ] as const)
      pen.dot(x, y, 0.1, T.coconutEye);
  },
  face: { y: 0.3, s: 0.9 },
  box: UNIT_BOX,
};

const PINE_CROWN = [
  [-0.42, -1.2],
  [0.42, -1.2],
  [-0.2, -1.36],
  [0.2, -1.36],
  [0, -1.42],
] as const;

const pineapple: PieceArt = {
  body(pen) {
    pen.body(T.pine);
    const lattice = P((b) => {
      for (let k = -2.4; k <= 2.4; k += 0.42) {
        b.M(k - 1, -1).L(k + 1, 1);
        b.M(k + 1, -1).L(k - 1, 1);
      }
    });
    pen.line(lattice, T.pine.d, 0.07, 0.85);
  },
  front(pen) {
    for (const [x, y] of PINE_CROWN)
      pen.over(
        P((b) => b.leaf(x * 0.25, -0.8, x, y, 0.13)),
        T.pineCrown
      );
  },
  face: { y: 0.15 },
  box: [-1, -1.465, 1, 1],
};

const watermelon: PieceArt = {
  body(pen) {
    pen.body(T.melon);
    for (const s of [-0.9, -0.5, 0.5, 0.9]) {
      const stripe = P((b) => {
        b.M(s * 0.05, -1.05);
        for (let y = -1; y <= 1.05; y += 0.1) {
          const w = Math.sqrt(Math.max(0, 1 - y * y));
          b.L(s * w + Math.sin(y * 14 + s * 3) * 0.04, y);
        }
      });
      pen.line(stripe, T.melon.o, 0.16, 0.9);
    }
  },
  face: { y: 0.1 },
  box: UNIT_BOX,
};

const pumpkin: PieceArt = {
  body(pen) {
    pen.body(T.pumpkin);
    for (const s of [-0.62, -0.25, 0.25, 0.62])
      pen.line(
        P((b) => b.M(s * 0.25, -0.92).Q(s * 1.45, 0, s * 0.25, 0.95)),
        T.pumpkin.d,
        0.08,
        0.75
      );
  },
  front(pen) {
    pen.over(
      P((b) =>
        b
          .M(-0.12, -0.84)
          .Q(-0.12, -1.12, -0.02, -1.28)
          .Q(0.12, -1.34, 0.2, -1.22)
          .Q(0.08, -1.08, 0.12, -0.84)
          .Z()
      ),
      T.pumpkinStem
    );
  },
  face: { y: 0.1 },
  box: [-1, -1.35, 1, 1],
};

/**
 * Dragonfruit (tier 8), take B of the three redraws, the owner's pick (2026-11-14): "simplified for
 * game size". A round magenta body that is the collider circle; flame-shaped bracts with a
 * pink-to-green base, a lighter green centre and a darker outline that fades into the skin; three
 * crown bracts on top as the one big overhang, and two side bracts a side peeking out behind it.
 */
/** One bract: base centre x, y, half width, tip x, y, notch depth, tip curl. */
type Bract = readonly [number, number, number, number, number, number, number];

const OUTLINE = 0.045;

function bract(pen: Pen, [bx, by, w, tx, ty, k, c]: Bract, opaqueBase: boolean): void {
  const { canvas } = pen;
  const path = P((s) => s.bract(bx, by, w, tx, ty, k, c));
  const base = opaqueBase ? rgba(T.dragonfruit.b) : rgba(T.bractBase, 0);
  const green = rgba(T.bract);
  canvas.drawPath(
    path,
    linear(bx, by, tx, ty, [base, mix(T.bractBase, T.bract, 0.55), green, green], [0, 0.3, 0.52, 1])
  );
  // The lighter centre: a smaller bract inset towards the tip.
  const inset = P((s) =>
    s.bract(
      bx + (tx - bx) * 0.3,
      by + (ty - by) * 0.3,
      w * 0.5,
      tx - (tx - bx) * 0.12,
      ty - (ty - by) * 0.12,
      k * 0.7,
      c * 0.6
    )
  );
  const light = rgba(T.bractLight, 0);
  canvas.drawPath(inset, linear(bx, by, tx, ty, [light, light, rgba(T.bractLight)], [0, 0.4, 0.7]));
  // The dark outline fades out at the base, so the bract grows out of the skin.
  const dark = rgba(T.bractDark);
  canvas.drawPath(
    path,
    asStroke(linear(bx, by, tx, ty, [rgba(T.bractDark, 0), dark, dark], [0.05, 0.35, 1]), OUTLINE)
  );
}

/** Each bract and its mirror image across the vertical axis. */
function mirror(list: readonly Bract[]): Bract[] {
  return list.flatMap((b) => [b, [-b[0], b[1], b[2], -b[3], b[4], b[5], -b[6]] as const]);
}

const CROWN: readonly Bract[] = [
  ...mirror([[-0.28, -0.75, 0.22, -0.36, -1.3, 0.35, 0.03]]),
  [0, -0.72, 0.3, 0, -1.45, 0.35, 0],
];
const TOP: Bract = [0, -0.5, 0.34, 0, -1.06, 0.34, 0];
const SIDES = mirror([
  [-0.72, 0.05, 0.22, -1.05, -0.42, 0.4, -0.03],
  [-0.72, 0.62, 0.2, -1.08, 0.24, 0.4, -0.02],
]);
const FRONT = mirror([
  [-0.6, -0.28, 0.23, -0.66, -0.8, 0.32, 0.02],
  [-0.58, 0.68, 0.22, -0.68, 0.24, 0.32, 0.02],
]);

const dragonfruit: PieceArt = {
  back(pen) {
    for (const b of SIDES) bract(pen, b, true);
  },
  body(pen) {
    pen.body(T.dragonfruit);
    for (const b of FRONT) bract(pen, b, false);
  },
  front(pen) {
    for (const b of CROWN) bract(pen, b, true);
    bract(pen, TOP, false);
  },
  face: { y: 0.06, s: 1.05, blush: T.dragonfruitBlush },
  box: [-1.135, -1.49, 1.135, 1],
};

export const FRUIT_ART: ArtSet = {
  pieces: [
    cherry,
    blueberry,
    lemon,
    grape,
    orange,
    apple,
    peach,
    coconut,
    dragonfruit,
    pineapple,
    watermelon,
    pumpkin,
  ],
  ink: T.ink,
  closedEyes: false,
};
