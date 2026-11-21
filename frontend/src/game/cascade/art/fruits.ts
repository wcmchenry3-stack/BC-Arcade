/**
 * #3698: the Fruits set, tiers 0-11 (#3920: the Peach removed, the Apple green; #3960/#3964: the
 * 12-tier ladder with the Lychee, Lime, Plum and Pomegranate drawn; the pieces they replaced are
 * kept as recipes in `FRUIT_ART.retired`, never drawn in play), as small descriptions for the
 * kawaii pen (`pen.ts`), in unit space (collider radius 1, centre 0, 0, y down). `body` is clipped
 * to the circle; `back` and `front` are the only parts drawn outside it, the owner-approved
 * overhangs (2026-11-14, and 2026-11-21 for #3964) (measured with the outline strokes, in radii
 * past the circle: see the table in `art/__tests__/art.test.ts`). `box` bounds each piece's ink,
 * strokes included, within 0.03 r.
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
const WHITE = CASCADE_ART.white;

/** A seeded random in [0, 1) (mulberry32): the scattered marks are fixed, so every render is identical. */
function mulberry(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A wobbly closed blob around (cx, cy), a bumpy "peeled window" or flesh edge. */
function wob(cx: number, cy: number, rx: number, ry: number, n: number, amp: number) {
  const pts: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const k = 1 + amp * (i % 2 ? 1 : -1);
    pts.push([cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]);
  }
  return P((b) => b.blob(pts));
}

const oval = (x: number, y: number, rx: number, ry: number) => P((b) => b.oval(x, y, rx, ry));

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

/** Retired (see `FRUIT_ART.retired`): the Blueberry, Fruits tier 1 until the 12-tier ladder (#3960). */
const blueberry: PieceArt = {
  body(pen) {
    pen.body(T.blueberry);
    const cx = 0.02;
    const cy = -0.5;
    const r = 0.27;
    const star = P((b) => {
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
        b.M(cx, cy).L(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.75);
      }
    });
    pen.line(star, T.blueberry.o, 0.13);
    pen.dot(cx, cy, 0.09, T.blueberryCalyx);
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

/**
 * The Lime (tier 2, #3964, owner pick B 2026-11-21): the cut slice. A dark green rind ring, pale
 * pith, eight radiating juicy segments, and the face on the flesh. Nothing overhangs.
 */
const lime: PieceArt = {
  body(pen) {
    pen.body(T.lime);
    pen.dot(0, 0, 0.84, T.limePith.outer);
    pen.dot(0, 0, 0.77, T.limePith.inner);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pen.fill(
        P((b) => b.leaf(ca * 0.1, sa * 0.1, ca * 0.7, sa * 0.7, 0.2)),
        T.limeFlesh[i % 2]!
      );
    }
    pen.dot(0, 0, 0.12, T.limePith.heart);
  },
  face: { y: 0.04, s: 0.95 },
  box: UNIT_BOX,
};

/**
 * The Lychee (tier 1, #3964, owner pick A 2026-11-21): a bumpy red-pink shell with a big pearly
 * peeled window below carrying the face, a stem and a leaf (overhang 0.225 r above the circle, 0.35 r radially at the leaf tip).
 */
const lychee: PieceArt = {
  body(pen) {
    pen.body(T.lychee);
    // A hex grid of small bumps over the whole shell.
    const sp = 0.27;
    const r = 0.1;
    for (let row = -5; row <= 5; row++) {
      for (let col = -5; col <= 5; col++) {
        const x = col * sp + (row % 2 ? sp / 2 : 0);
        const y = row * sp * 0.87;
        if (Math.hypot(x, y) > 1.02) continue;
        pen.dot(x, y, r, T.lycheeBump.d, 0.5);
        pen.dot(x - r * 0.25, y - r * 0.3, r * 0.45, T.lycheeBump.l, 0.7);
      }
    }
    pen.fill(wob(0, 0.34, 0.86, 0.7, 14, 0.035), T.lycheePeel.rim);
    pen.fill(wob(0, 0.36, 0.8, 0.64, 14, 0.035), T.lycheePeel.edge);
    pen.fill(wob(0, 0.38, 0.75, 0.6, 14, 0.035), T.lycheePeel.flesh);
    pen.fill(oval(-0.3, 0.12, 0.3, 0.1), WHITE, 0.7);
    pen.fill(oval(0, 0.8, 0.5, 0.1), T.lycheePeel.shade, 0.5);
  },
  front(pen) {
    const stem = P((b) => b.M(0.04, -0.88).Q(0.06, -1.0, 0.14, -1.1));
    pen.line(stem, T.stemDark, 0.15);
    pen.line(stem, T.lycheeStem, 0.08);
    pen.over(
      P((b) => b.leaf(0.12, -1.04, 0.62, -1.16, 0.13)),
      T.leafFresh
    );
  },
  face: { x: 0, y: 0.34, s: 0.82, blush: T.blushPink },
  box: [-1, -1.23, 1, 1],
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

/** Retired (see `FRUIT_ART.retired`): the Grape, Fruits tier 3 until the 12-tier ladder (#3960; tier 4 with the placeholder). */
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

/**
 * The Plum (tier 4, #3964, owner pick B "Santa Rosa" 2026-11-21): violet shoulders fading to ruby
 * red, pale speckles, a seam, and a stem with a green leaf (overhang about 0.31 r above the circle, about 0.42 r radially at the leaf tip). Its face ink is
 * dark: a light ink read as white blobs on it.
 */
const plum: PieceArt = {
  body(pen) {
    pen.body(T.plum);
    pen.canvas.drawCircle(
      0,
      0,
      1,
      linear(
        -0.2,
        -1,
        0.1,
        0.7,
        [rgba(T.plumShoulder[0]!, 0.95), rgba(T.plumShoulder[1]!, 0.8), rgba(T.plum.b, 0)],
        [0, 0.45, 1]
      )
    );
    pen.fill(
      P((b) =>
        b.blob([
          [-0.8, -0.2],
          [-0.55, -0.72],
          [0, -0.85],
          [0.1, -0.35],
          [-0.35, 0.05],
        ])
      ),
      T.plumBloom,
      0.2
    );
    const r = mulberry(3);
    for (let i = 0; i < 14; i++) {
      const a = r() * 6.283;
      const d = Math.sqrt(r()) * 0.85;
      pen.dot(Math.cos(a) * d, Math.sin(a) * d, 0.022, T.plumSpeck, 0.55);
    }
    pen.line(
      P((b) => b.M(0.02, -0.82).Q(0.55, -0.15, 0.2, 0.92)),
      T.plumSeam,
      0.065,
      0.5
    );
  },
  front(pen) {
    const stem = P((b) => b.M(0, -0.86).Q(0.03, -1.01, 0.06, -1.16));
    pen.line(stem, T.stemDark, 0.17);
    pen.line(stem, T.plumStem, 0.09);
    pen.over(
      P((b) => b.leaf(0.06, -1.1, 0.62, -1.24, 0.15)),
      T.leafFresh
    );
  },
  face: { x: -0.16, y: 0.14, s: 0.9, blush: T.plumBlush },
  box: [-1, -1.32, 1, 1],
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

/** The apple's drawing in a skin colour: green in play (#3920), red when retired. */
function appleIn(skin: typeof T.apple | typeof T.appleRed): PieceArt {
  return {
    body(pen) {
      pen.body(skin);
      pen.line(
        P((b) => b.M(-0.22, -0.84).Q(0, -0.7, 0.22, -0.84)),
        skin.d,
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
}

/** #3920: the Apple is green in play, so it no longer reads as the Cherry. */
const apple = appleIn(T.apple);

/** Retired by #3920 (see `FRUIT_ART.retired`): the red Apple, the Apple until #3920. */
const appleRed = appleIn(T.appleRed);

/** Retired by #3920 (see `FRUIT_ART.retired`): the Peach, Fruits tier 6 until #3920. */
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
  const r = mulberry(7); // the approved render's seed
  return Array.from({ length: 9 }, () => {
    const ang = r() * 6.28;
    const d = 0.25 + r() * 0.65;
    return [Math.cos(ang) * d, Math.sin(ang) * d, ang + 1.4 + (r() - 0.5) * 0.6] as const;
  });
})();

/** Retired (see `FRUIT_ART.retired`): the Coconut, Fruits tier 6 until #3960 (tier 7 with the placeholder). */
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

/** A pomegranate calyx: a collar and `points` flared, pointed sepals fanned over the top. */
function calyx(pen: Pen, cy: number, w: number, h: number): void {
  const points = 5;
  const spread = 62;
  for (let i = 0; i < points; i++) {
    const a = ((-90 - spread + (i * 2 * spread) / (points - 1)) * Math.PI) / 180;
    const len = h * (i === 0 || i === points - 1 ? 0.85 : 1);
    pen.over(
      P((b) => b.leaf(0, cy + 0.04, Math.cos(a) * len, cy + 0.04 + Math.sin(a) * len, w * 0.5)),
      T.pomegranateCalyx
    );
  }
  pen.over(
    P((b) => b.oval(0, cy + 0.02, w * 0.62, w * 0.42)),
    T.pomegranateCalyx
  );
}

/**
 * The Pomegranate (tier 7, #3964, owner pick A "leathery red" 2026-11-21): red with an orange
 * blush and wine blotches, a spiky tan-brown calyx, no seeds (overhang about 0.27 r, the calyx).
 * Its face ink is dark.
 */
const pomegranate: PieceArt = {
  body(pen) {
    pen.body(T.pomegranate);
    pen.fill(
      P((b) =>
        b.blob([
          [-0.75, -0.3],
          [-0.3, -0.75],
          [0.2, -0.55],
          [-0.1, 0],
          [-0.6, 0.25],
        ])
      ),
      T.pomegranateBlush,
      0.35
    );
    pen.fill(
      P((b) =>
        b.blob([
          [0.35, 0.3],
          [0.8, 0.2],
          [0.85, 0.65],
          [0.4, 0.85],
          [0.2, 0.55],
        ])
      ),
      T.pomegranateWine,
      0.35
    );
    pen.fill(
      P((b) =>
        b.blob([
          [0.45, -0.6],
          [0.8, -0.35],
          [0.6, -0.1],
          [0.35, -0.3],
        ])
      ),
      T.pomegranateWine,
      0.25
    );
  },
  front(pen) {
    calyx(pen, -0.86, 0.3, 0.42);
  },
  face: { y: 0.14, s: 1 },
  box: [-1, -1.28, 1, 1],
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
 * Dragonfruit (tier 7 since #3920), take B of the three redraws, the owner's pick (2026-11-14): "simplified for
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

/** The fig's stem: a short twig out of the top of the fruit. */
function figStem(pen: Pen, y0: number, y1: number): void {
  const stem = P((b) => b.M(0, y0).L(0.02, y1));
  pen.line(stem, T.stemDark, 0.13);
  pen.line(stem, T.figStem, 0.07);
}

/**
 * Retired, never used (see `FRUIT_ART.retired`): Fig B, a halved fig, proposed for Fruits tier 1 in
 * #3960 (the owner picked the Lychee). Purple skin ring, cream rind, rose-red seeded pulp round a
 * pale hollow carrying the face.
 */
const figB: PieceArt = {
  body(pen) {
    pen.body(T.figB);
    pen.dot(0, 0, 0.86, T.figBInner.rind);
    pen.dot(0, 0, 0.8, T.figBInner.pulp);
    pen.dot(0, 0, 0.64, T.figBInner.pulpIn);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + 0.1;
      pen.line(
        P((b) =>
          b.M(Math.cos(a) * 0.5, Math.sin(a) * 0.5).L(Math.cos(a) * 0.76, Math.sin(a) * 0.76)
        ),
        T.figBInner.vein,
        0.03,
        0.5
      );
    }
    for (let i = 0; i < 26; i++) {
      const a = (i / 26) * Math.PI * 2 + 0.2 * (i % 3);
      const d = 0.58 + (i % 3) * 0.075;
      pen.dot(Math.cos(a) * d, Math.sin(a) * d, 0.026, T.figBInner.seed, 0.95);
    }
    pen.fill(wob(0, 0.04, 0.54, 0.5, 10, 0.05), T.figBInner.hollow);
    pen.fill(oval(-0.2, -0.28, 0.18, 0.06), WHITE, 0.6);
  },
  front(pen) {
    figStem(pen, -0.9, -1.13);
  },
  face: { x: 0, y: 0.08, s: 0.72, blush: T.figBlush },
  box: [-1, -1.2, 1, 1],
};

/**
 * Retired, never used (see `FRUIT_ART.retired`): Fig C, the Kadota, proposed for Fruits tier 1 in
 * #3960. Olive-gold green-brown with pale streaks, an amber blush and a tapering neck.
 */
const figC: PieceArt = {
  back(pen) {
    pen.over(
      P((b) =>
        b.blob([
          [-0.46, -0.66],
          [-0.24, -1],
          [0, -1.14],
          [0.24, -1],
          [0.46, -0.66],
          [0, -0.55],
        ])
      ),
      T.kadota
    );
    figStem(pen, -1.1, -1.26);
  },
  body(pen) {
    pen.body(T.kadota);
    for (let i = 0; i < 7; i++)
      pen.line(
        P((b) => b.M(-0.72 + i * 0.24, -0.95).Q(-0.95 + i * 0.32, -0.1, -0.5 + i * 0.17, 0.85)),
        T.kadotaStreak,
        0.03,
        0.4
      );
    pen.fill(wob(0.15, 0.62, 0.7, 0.4, 8, 0.1), T.kadotaBlush, 0.35);
    pen.fill(oval(0, 0.93, 0.07, 0.05), T.kadotaEye, 0.9);
  },
  face: { y: 0.1, s: 0.95, blush: T.kadotaCheek },
  box: [-1, -1.33, 1, 1],
};

/** Mangosteen's calyx: five green petals round a centre, and a short stalk. */
function mangosteenCalyx(pen: Pen, cx: number, cy: number): void {
  for (let i = 0; i < 5; i++) {
    const a = ((-90 - 70 + i * 35) * Math.PI) / 180;
    pen.over(
      P((b) => b.leaf(cx, cy, cx + Math.cos(a) * 0.36, cy + Math.sin(a) * 0.3, 0.1)),
      T.mangosteenCalyx
    );
  }
  pen.over(
    P((b) => b.oval(cx, cy, 0.13, 0.08)),
    T.mangosteenCalyx
  );
  pen.line(
    P((b) => b.M(cx, cy - 0.04).L(cx + 0.02, cy - 0.2)),
    T.mangosteenCalyxStem,
    0.07
  );
}

/**
 * Retired, never used (see `FRUIT_ART.retired`): Mangosteen B, halved, proposed for Fruits tier 1
 * in #3960. A wine rind ring with a magenta inner rind, six white segments round a centre, a cap.
 */
const mangosteenB: PieceArt = {
  body(pen) {
    pen.body(T.mangosteen);
    pen.dot(0, 0, 0.88, T.mangosteenInner.rind);
    pen.dot(0, 0, 0.82, T.mangosteenInner.flesh);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.26;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      pen.fill(
        P((b) => b.leaf(ca * 0.1, sa * 0.1, ca * 0.76, sa * 0.76, 0.3)),
        T.mangosteenSegments[i % 2]!
      );
      pen.line(
        P((b) => b.M(ca * 0.5, sa * 0.5).L(ca * 0.8, sa * 0.8)),
        T.mangosteenInner.groove,
        0.03,
        0.8
      );
    }
    pen.fill(oval(-0.4, -0.5, 0.22, 0.07), WHITE, 0.6);
  },
  front(pen) {
    mangosteenCalyx(pen, 0, -0.9);
  },
  face: { y: 0.06, s: 0.8, blush: T.blushPink },
  box: [-1, -1.25, 1, 1],
};

export const FRUIT_ART: ArtSet = {
  pieces: [
    cherry,
    lychee,
    lime,
    lemon,
    plum,
    orange,
    apple,
    pomegranate,
    dragonfruit,
    pineapple,
    watermelon,
    pumpkin,
  ],
  ink: T.ink,
  closedEyes: false,
  // Kept as recipes, never drawn in play (docs/games/cascade-decisions.md#retired-pieces-3920).
  retired: {
    peach: { art: peach, ink: T.retiredInk.peach, was: "tier 6; removed from the ladder by #3920" },
    appleRed: {
      art: appleRed,
      ink: T.retiredInk.appleRed,
      was: "the Apple (tier 5) until #3920, which made it green",
    },
    blueberry: {
      art: blueberry,
      ink: T.retiredInk.blueberry,
      was: "tier 1 until the 12-tier ladder (#3960); the Lychee replaced it (#3964)",
    },
    grape: {
      art: grape,
      ink: T.retiredInk.grape,
      was: "tier 3 until the 12-tier ladder (#3960, tier 4 with the placeholder); the Plum replaced it (#3964)",
    },
    coconut: {
      art: coconut,
      ink: T.retiredInk.coconut,
      was: "tier 6 until the 12-tier ladder (#3960, tier 7 with the placeholder); the Pomegranate replaced it (#3964)",
    },
    figB: {
      art: figB,
      ink: T.retiredInk.figB,
      was: "proposed for tier 1 in #3960; not used",
    },
    figC: {
      art: figC,
      ink: T.retiredInk.figC,
      was: "proposed for tier 1 in #3960; not used",
    },
    mangosteenB: {
      art: mangosteenB,
      ink: T.retiredInk.mangosteenB,
      was: "proposed for tier 1 in #3960; not used",
    },
  },
};
