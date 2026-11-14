/**
 * #3698: the Cosmos set, tiers 0-11, as small descriptions for the kawaii pen (`pen.ts`); see
 * `fruits.ts` for the unit space. Overhangs (owner-approved 2026-11-14): Saturn's rings 0.33 r
 * each side and Uranus's ring 0.26 r, each drawn as a back arc (before the body) and a front arc
 * (after it), never clipped; no haze on the Sun or the Milky Way.
 *
 * The look-alike groups get a second cue besides hue: Moon (light, big dark maria), Pluto (tan,
 * pale heart), Mercury (dark, peppered with craters); Neptune (deep blue, bands and a dark spot)
 * against Uranus (pale, plain, near-vertical ring).
 */
import { CASCADE_ART } from "../../../theme/theme.cascade";
import { P, UNIT_BOX, radial, rgba, type ArtSet, type Pen, type PieceArt, type Tone } from "./pen";

const T = CASCADE_ART.cosmos;

/** mulberry32: the fixed scatter of craters and stars (the approved renders' seeds). */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A wavy band across the globe at height `y`. */
function band(pen: Pen, y: number, h: number, color: string, a = 1, wav = 0): void {
  pen.line(
    P((b) => {
      b.M(-1.1, y);
      for (let x = -1.1; x <= 1.1; x += 0.1) b.L(x, y + Math.sin(x * 6 + y * 9) * wav);
    }),
    color,
    h,
    a
  );
}

/** Half a ring (the back half, or the front half), outlined. */
function ring(
  pen: Pen,
  rx: number,
  ry: number,
  tilt: number,
  w: number,
  t: Tone,
  front: boolean,
  gap: boolean
) {
  const c = pen.canvas;
  const start = front ? 0 : 180;
  c.save();
  c.rotate(tilt, 0, 0);
  pen.line(
    P((b) => b.arc(0, 0, rx, ry, start, 180)),
    t.b,
    w
  );
  if (gap)
    pen.line(
      P((b) => b.arc(0, 0, rx * 1.02, ry * 1.02, start, 180)),
      t.d!,
      w * 0.18,
      0.8
    );
  for (const e of [w / 2, -w / 2])
    pen.line(
      P((b) => b.arc(0, 0, rx + e, ry + e, start, 180)),
      t.o!,
      0.035
    );
  c.restore();
}

const moon: PieceArt = {
  body(pen) {
    pen.body(T.moon);
    pen.fill(
      P((b) =>
        b.blob([
          [-0.6, -0.4],
          [-0.1, -0.55],
          [0.15, -0.2],
          [-0.15, 0.15],
          [-0.65, 0.05],
        ])
      ),
      T.maria
    );
    pen.fill(
      P((b) =>
        b.blob([
          [0.25, 0.15],
          [0.65, 0.05],
          [0.7, 0.45],
          [0.35, 0.6],
        ])
      ),
      T.maria
    );
    pen.crater(0.35, -0.55, 0.14, T.moon);
    pen.crater(-0.35, 0.6, 0.12, T.moon);
  },
  face: { y: 0.1 },
  box: UNIT_BOX,
};

const pluto: PieceArt = {
  body(pen) {
    pen.body(T.pluto);
    pen.fill(
      P((b) =>
        b.blob([
          [-1, 0.2],
          [-0.55, 0.3],
          [-0.2, 0.75],
          [-0.6, 1],
          [-1, 0.8],
        ])
      ),
      T.plutoDark
    );
    // The heart (Tombaugh Regio).
    pen.fill(
      P((b) =>
        b
          .M(0.25, 0.75)
          .C(-0.25, 0.4, -0.2, -0.05, 0.05, -0.05)
          .C(0.18, -0.05, 0.25, 0.05, 0.27, 0.12)
          .C(0.32, 0.0, 0.42, -0.08, 0.55, -0.05)
          .C(0.85, 0.05, 0.7, 0.45, 0.25, 0.75)
          .Z()
      ),
      T.plutoHeart
    );
  },
  face: { y: -0.15, s: 0.9 },
  box: UNIT_BOX,
};

const MERCURY_CRATERS = (() => {
  const r = rng(11);
  return Array.from({ length: 6 }, () => {
    const a = r() * 6.28;
    const d = Math.sqrt(r()) * 0.85;
    return [Math.cos(a) * d, Math.sin(a) * d, 0.06 + r() * 0.12] as const;
  });
})();

const mercury: PieceArt = {
  body(pen) {
    pen.body(T.mercury);
    for (const [x, y, s] of MERCURY_CRATERS) pen.crater(x, y, s, T.mercury);
  },
  face: { y: 0.1 },
  box: UNIT_BOX,
};

const mars: PieceArt = {
  body(pen) {
    pen.body(T.mars);
    pen.fill(
      P((b) =>
        b.blob([
          [-0.8, -0.1],
          [-0.3, -0.25],
          [0.2, -0.05],
          [0.6, 0.1],
          [0.3, 0.3],
          [-0.4, 0.25],
        ])
      ),
      T.marsDark,
      0.8
    );
    pen.fill(
      P((b) => b.oval(0, -0.95, 0.5, 0.2)),
      T.marsCap
    );
  },
  face: { y: 0.15 },
  box: UNIT_BOX,
};

const venus: PieceArt = {
  body(pen) {
    pen.body(T.venus);
    [-0.55, 0.05, 0.6].forEach((y, i) => band(pen, y, 0.13, T.venusBands[i % 2]!, 0.55, 0.06));
  },
  face: { y: 0.1 },
  box: UNIT_BOX,
};

const earth: PieceArt = {
  body(pen) {
    pen.body(T.earth);
    pen.fill(
      P((b) =>
        b.blob([
          [-0.6, -0.75],
          [-0.15, -0.55],
          [-0.25, -0.15],
          [-0.05, 0.25],
          [-0.25, 0.75],
          [-0.55, 0.3],
          [-0.85, -0.1],
        ])
      ),
      T.land
    );
    pen.fill(
      P((b) =>
        b.blob([
          [0.3, -0.5],
          [0.75, -0.35],
          [0.8, 0.1],
          [0.5, 0.3],
          [0.35, 0.0],
        ])
      ),
      T.land
    );
    for (const [x, y, l] of [
      [-0.3, -0.35, 0.5],
      [0.2, 0.5, 0.55],
      [0.4, -0.75, 0.35],
    ] as const)
      pen.line(
        P((b) => b.M(x, y).Q(x + l / 2, y - 0.08, x + l, y)),
        CASCADE_ART.white,
        0.09,
        0.85
      );
  },
  face: { y: 0.12 },
  box: UNIT_BOX,
};

const neptune: PieceArt = {
  body(pen) {
    pen.body(T.neptune);
    band(pen, -0.45, 0.16, T.neptuneBands[0], 0.7);
    band(pen, 0.3, 0.12, T.neptuneBands[1], 0.7);
    pen.fill(
      P((b) => b.oval(-0.32, 0.62, 0.24, 0.12)),
      T.neptuneSpot
    );
    pen.line(
      P((b) => b.M(-0.02, 0.52).Q(0.18, 0.47, 0.4, 0.54)),
      T.neptuneStreak,
      0.07,
      0.9
    );
  },
  face: { y: 0.2 },
  box: UNIT_BOX,
};

/** Uranus's near-vertical ring: its back half is the left side, its front half the right. */
function uranusRing(pen: Pen, start: number): void {
  const c = pen.canvas;
  c.save();
  c.rotate(12, 0, 0);
  const arc = P((b) => b.arc(0, 0, 0.3, 1.22, start, 180));
  pen.line(arc, T.uranusRing.b, 0.1);
  pen.line(arc, T.uranusRing.o, 0.02);
  c.restore();
}

const uranus: PieceArt = {
  back(pen) {
    ring(pen, 0.3, 1.22, 12, 0.1, T.uranusRing, false, false);
  },
  body(pen) {
    pen.body(T.uranus);
  },
  front(pen) {
    uranusRing(pen, -90);
  },
  face: { x: -0.25, y: 0.1, s: 0.85 },
  box: [-1, -1.3, 1, 1.3],
};

const saturn: PieceArt = {
  back(pen) {
    ring(pen, 1.2, 0.36, -14, 0.24, T.saturnRingBack, false, true);
  },
  body(pen) {
    pen.body(T.saturn);
    const [b1, b2, b3] = T.saturnBands;
    band(pen, -0.55, 0.14, b1, 0.7);
    band(pen, -0.2, 0.1, b2, 0.7);
    band(pen, 0.5, 0.18, b3, 0.6);
    // The ring's shadow on the globe.
    pen.canvas.save();
    pen.canvas.rotate(-14, 0, 0);
    pen.line(
      P((b) => b.arc(0, 0.1, 1.2, 0.36, 20, 140)),
      T.saturnShadow,
      0.1,
      0.3
    );
    pen.canvas.restore();
  },
  front(pen) {
    ring(pen, 1.2, 0.36, -14, 0.24, T.saturnRingFront, true, true);
  },
  face: { y: -0.12, s: 0.85 },
  box: [-1.35, -1, 1.35, 1],
};

const jupiter: PieceArt = {
  body(pen) {
    pen.body(T.jupiter);
    [-0.75, -0.45, -0.2, 0.1, 0.35, 0.7].forEach((y, i) =>
      band(pen, y, 0.16, T.jupiterBands[i]!, 0.85, 0.03)
    );
    pen.fill(
      P((b) => b.oval(0.38, 0.38, 0.22, 0.12)),
      T.jupiterSpot
    );
  },
  face: { y: -0.05 },
  box: UNIT_BOX,
};

const sun: PieceArt = {
  gloss: 0.35,
  shadow: 0.4,
  body(pen) {
    pen.body(T.sun);
    pen.dot(0.45, 0.4, 0.07, T.sunSpot, 0.8);
    pen.dot(0.58, 0.32, 0.04, T.sunSpot, 0.8);
    pen.line(
      P((b) => b.arc(0, 0, 0.88, 0.88, 0, 360)),
      T.sunRing,
      0.12,
      0.5
    );
  },
  face: { y: 0.05, blush: T.sunBlush },
  box: UNIT_BOX,
};

const STARS = (() => {
  const r = rng(9);
  return Array.from({ length: 14 }, () => {
    const a = r() * 6.28;
    const d = Math.sqrt(r()) * 0.95;
    return [Math.cos(a) * d, Math.sin(a) * d, 0.012 + r() * 0.02, 0.6 + r() * 0.4] as const;
  });
})();

const milkyWay: PieceArt = {
  gloss: 0.25,
  shadow: 0.5,
  body(pen) {
    pen.body(T.galaxy);
    for (const [x, y, s, a] of STARS) pen.dot(x, y, s, CASCADE_ART.white, a);
    for (const arm of [0, Math.PI]) {
      const spiral = P((b) => {
        for (let t = 0; t <= 1; t += 0.04) {
          const a = arm + t * 4.2;
          const d = 0.12 + t * 0.78;
          const x = Math.cos(a) * d;
          const y = Math.sin(a) * d * 0.8;
          if (t === 0) b.M(x, y);
          else b.L(x, y);
        }
      });
      pen.line(spiral, T.galaxyArm, 0.26, 0.45);
      pen.line(spiral, T.galaxyArmCore, 0.09, 0.85);
    }
    const [c0, c1, c2] = T.galaxyCore;
    pen.canvas.drawCircle(
      0,
      0,
      0.36,
      radial(0, 0, 0.36, [rgba(c0), rgba(c1), rgba(c2, 0)], [0, 0.4, 1])
    );
  },
  face: { y: 0.0, s: 0.75, blush: T.galaxyBlush },
  box: UNIT_BOX,
};

export const COSMOS_ART: ArtSet = {
  pieces: [
    moon,
    pluto,
    mercury,
    mars,
    venus,
    earth,
    neptune,
    uranus,
    saturn,
    jupiter,
    sun,
    milkyWay,
  ],
  ink: T.ink,
  closedEyes: true,
};
