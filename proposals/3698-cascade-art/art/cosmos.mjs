/**
 * #3698 proposal: the Cosmos set as small descriptions in unit space (see fruits.mjs).
 * Colour-blind groups get a second cue besides hue: Moon (light, big dark maria), Pluto (mid tan,
 * pale heart), Mercury (dark, peppered with small craters); Neptune (deep blue, bands + dark
 * spot) vs Uranus (pale, plain, vertical ring).
 */
const T = {
  moon: { b: "#cfd0d4", l: "#f2f2f4", d: "#8e9098" },
  maria: { b: "#9d9fa8", l: "#b4b6bd", d: "#868892" },
  pluto: { b: "#c99d76", l: "#e9c9a6", d: "#8d6244" },
  mercury: { b: "#7f776d", l: "#a49b8f", d: "#4e4842" },
  mars: { b: "#c4532c", l: "#ec8152", d: "#7c2a12" },
  venus: { b: "#e9c87c", l: "#fbe6ae", d: "#b48b3c" },
  earth: { b: "#2f72d6", l: "#68a8ff", d: "#173f8c" },
  land: { b: "#3fa64e", l: "#78d07a", d: "#24702f" },
  neptune: { b: "#2a4fd6", l: "#5b80ff", d: "#132683" },
  uranus: { b: "#9fe2e6", l: "#dbf8f8", d: "#5fb0bb" },
  saturn: { b: "#e1bf7f", l: "#f7e0b0", d: "#a98348" },
  jupiter: { b: "#d9a877", l: "#f3d6ae", d: "#97643a" },
  sun: { b: "#ffb31c", l: "#ffe36a", d: "#f07000" },
  galaxy: { b: "#1d1650", l: "#3d2f96", d: "#0a0822" },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const crater = (base) => ({ b: base.b, l: base.l, d: base.d });
const band = (pen, y, h, color, a = 1, wav = 0) =>
  pen.line(pen.P((b) => { b.M(-1.1, y); for (let x = -1.1; x <= 1.1; x += 0.1) b.L(x, y + Math.sin(x * 6 + y * 9) * wav); }), color, h, a);

/** Saturn / Uranus ring: back half before the body, front half after it (never clipped). */
function ring(pen, rx, ry, tilt, w, color, gap, front) {
  const c = pen.canvas;
  c.save();
  c.rotate(tilt, 0, 0);
  const start = front ? 0 : 180;
  pen.line(pen.P((b) => b.arc(0, 0, rx, ry, start, 180)), color.b, w);
  if (gap) pen.line(pen.P((b) => b.arc(0, 0, rx * 1.02, ry * 1.02, start, 180)), color.d, w * 0.18, 0.8);
  if (pen.style === "kawaii") {
    pen.line(pen.P((b) => b.arc(0, 0, rx + w / 2, ry + w / 2, start, 180)), color.o, 0.035);
    pen.line(pen.P((b) => b.arc(0, 0, rx - w / 2, ry - w / 2, start, 180)), color.o, 0.035);
  }
  c.restore();
}

export const COSMOS = [
  {
    name: "Moon",
    overhang: "none",
    body(pen) {
      pen.body(T.moon);
      pen.fill(pen.P((b) => b.blob([[-0.6, -0.4], [-0.1, -0.55], [0.15, -0.2], [-0.15, 0.15], [-0.65, 0.05]])), T.maria);
      pen.fill(pen.P((b) => b.blob([[0.25, 0.15], [0.65, 0.05], [0.7, 0.45], [0.35, 0.6]])), T.maria);
      pen.crater(0.35, -0.55, 0.14, crater(T.moon));
      pen.crater(-0.35, 0.6, 0.12, crater(T.moon));
      if (!pen.simple) pen.crater(0.05, 0.75, 0.07, crater(T.moon));
    },
    face: { y: 0.1, ink: "#2a2a33" },
  },
  {
    name: "Pluto",
    overhang: "none",
    body(pen) {
      pen.body(T.pluto);
      pen.fill(pen.P((b) => b.blob([[-1, 0.2], [-0.55, 0.3], [-0.2, 0.75], [-0.6, 1], [-1, 0.8]])), { b: "#7d4a33", l: "#9a6048", d: "#5e3422" });
      // the heart (Tombaugh Regio)
      pen.fill(pen.P((b) => b.M(0.25, 0.75).C(-0.25, 0.4, -0.2, -0.05, 0.05, -0.05).C(0.18, -0.05, 0.25, 0.05, 0.27, 0.12)
        .C(0.32, 0.0, 0.42, -0.08, 0.55, -0.05).C(0.85, 0.05, 0.7, 0.45, 0.25, 0.75).Z()), { b: "#f6ead6", l: "#ffffff", d: "#ddc9ad" });
    },
    face: { y: -0.15, s: 0.9, ink: "#3a2416" },
  },
  {
    name: "Mercury",
    overhang: "none",
    body(pen) {
      pen.body(T.mercury);
      const r = rng(11);
      const n = pen.simple ? 6 : 13;
      for (let i = 0; i < n; i++) {
        const a = r() * 6.28, d = Math.sqrt(r()) * 0.85, s = 0.06 + r() * 0.12;
        pen.crater(Math.cos(a) * d, Math.sin(a) * d, s, crater(T.mercury));
      }
    },
    face: { y: 0.1, ink: "#1a1612" },
  },
  {
    name: "Mars",
    overhang: "none",
    body(pen) {
      pen.body(T.mars);
      pen.fill(pen.P((b) => b.blob([[-0.8, -0.1], [-0.3, -0.25], [0.2, -0.05], [0.6, 0.1], [0.3, 0.3], [-0.4, 0.25]])), { b: "#8e3418", l: "#a8452a", d: "#6d2610" }, 0.8);
      pen.fill(pen.P((b) => b.oval(0, -0.95, 0.5, 0.2)), { b: "#fbf3ee", l: "#ffffff", d: "#e0d4cc" });
      if (!pen.simple) pen.line(pen.P((b) => b.M(-0.5, 0.45).Q(0, 0.38, 0.45, 0.5)), "#7c2a12", 0.05, 0.7);
    },
    face: { y: 0.15, ink: "#3a1004" },
  },
  {
    name: "Venus",
    overhang: "none",
    body(pen) {
      pen.body(T.venus);
      const ys = pen.simple ? [-0.55, 0.05, 0.6] : [-0.7, -0.35, 0, 0.35, 0.7];
      ys.forEach((y, i) => band(pen, y, 0.13, i % 2 ? "#fff2c8" : "#c9a050", 0.55, 0.06));
    },
    face: { y: 0.1, ink: "#4a3006" },
  },
  {
    name: "Earth",
    overhang: "none",
    body(pen) {
      pen.body(T.earth);
      pen.fill(pen.P((b) => b.blob([[-0.6, -0.75], [-0.15, -0.55], [-0.25, -0.15], [-0.05, 0.25], [-0.25, 0.75], [-0.55, 0.3], [-0.85, -0.1]])), T.land);
      pen.fill(pen.P((b) => b.blob([[0.3, -0.5], [0.75, -0.35], [0.8, 0.1], [0.5, 0.3], [0.35, 0.0]])), T.land);
      for (const [x, y, l] of [[-0.3, -0.35, 0.5], [0.2, 0.5, 0.55], [0.4, -0.75, 0.35]])
        pen.line(pen.P((b) => b.M(x, y).Q(x + l / 2, y - 0.08, x + l, y)), "#ffffff", 0.09, 0.85);
    },
    face: { y: 0.12, ink: "#0c1e44" },
  },
  {
    name: "Neptune",
    overhang: "none",
    body(pen) {
      pen.body(T.neptune);
      band(pen, -0.45, 0.16, "#4a70f0", 0.7);
      band(pen, 0.3, 0.12, "#1a35a8", 0.7);
      pen.fill(pen.P((b) => b.oval(-0.32, 0.62, 0.24, 0.12)), { b: "#101e6a", l: "#1a2c88", d: "#0a1450" });
      pen.line(pen.P((b) => b.M(-0.02, 0.52).Q(0.18, 0.47, 0.4, 0.54)), "#d8e6ff", 0.07, 0.9);
    },
    face: { y: 0.2, ink: "#e8f0ff" },
  },
  {
    name: "Uranus",
    overhang: "vertical ring, 0.26 r above and below",
    back(pen) {
      ring(pen, 0.3, 1.22, 12, 0.1, { b: "#e6fbff", d: "#9fd8e0", o: "#4d8f99" }, false, false);
    },
    body(pen) {
      pen.body(T.uranus);
      if (!pen.simple) band(pen, -0.75, 0.2, "#c6f2f2", 0.6);
    },
    front(pen) {
      // nearly-vertical ring: its front half is the right-hand side
      const c = pen.canvas;
      c.save();
      c.rotate(12, 0, 0);
      pen.line(pen.P((b) => b.arc(0, 0, 0.3, 1.22, -90, 180)), "#e6fbff", 0.1);
      if (pen.style === "kawaii") pen.line(pen.P((b) => b.arc(0, 0, 0.3, 1.22, -90, 180)), "#4d8f99", 0.02);
      c.restore();
    },
    face: { x: -0.25, y: 0.1, s: 0.85, ink: "#18454c" },
  },
  {
    name: "Saturn",
    overhang: "rings: 0.33 r each side, back + front arcs",
    back(pen) {
      ring(pen, 1.2, 0.36, -14, 0.24, { b: "#d8bf8c", d: "#8c7044", o: "#6a5230" }, true, false);
    },
    body(pen) {
      pen.body(T.saturn);
      band(pen, -0.55, 0.14, "#c9a062", 0.7);
      band(pen, -0.2, 0.1, "#f6e2b8", 0.7);
      band(pen, 0.5, 0.18, "#c29658", 0.6);
      // ring shadow on the globe
      pen.canvas.save();
      pen.canvas.rotate(-14, 0, 0);
      pen.line(pen.P((b) => b.arc(0, 0.1, 1.2, 0.36, 20, 140)), "#5a4020", 0.1, 0.3);
      pen.canvas.restore();
    },
    front(pen) {
      ring(pen, 1.2, 0.36, -14, 0.24, { b: "#e7d3a6", d: "#8c7044", o: "#6a5230" }, true, true);
    },
    face: { y: -0.12, s: 0.85, ink: "#3a2a0e" },
  },
  {
    name: "Jupiter",
    overhang: "none",
    body(pen) {
      pen.body(T.jupiter);
      const bands = [[-0.75, "#b8784a"], [-0.45, "#f1dcbc"], [-0.2, "#c08250"], [0.1, "#f3e0c4"], [0.35, "#b97848"], [0.7, "#d9b088"]];
      for (const [y, col] of bands) band(pen, y, 0.16, col, 0.85, 0.03);
      pen.fill(pen.P((b) => b.oval(0.38, 0.38, 0.22, 0.12)), { b: "#c4452a", l: "#e0674a", d: "#8c2a14" });
    },
    face: { y: -0.05, ink: "#3a1c06" },
  },
  {
    name: "Sun",
    overhang: "none",
    gloss: 0.35,
    shadow: 0.4,
    body(pen) {
      pen.body(T.sun);
      const r = rng(5);
      if (!pen.simple)
        for (let i = 0; i < 16; i++) {
          const a = r() * 6.28, d = Math.sqrt(r()) * 0.85;
          pen.dot(Math.cos(a) * d, Math.sin(a) * d, 0.07 + r() * 0.06, "#ffe36a", 0.45);
        }
      pen.dot(0.45, 0.4, 0.07, "#c45a00", 0.8);
      pen.dot(0.58, 0.32, 0.04, "#c45a00", 0.8);
      pen.line(pen.P((b) => b.arc(0, 0, 0.88, 0.88, 0, 360)), "#ff8a00", 0.12, 0.5);
    },
    face: { y: 0.05, ink: "#6a2a00", blush: "#ff5a3a" },
  },
  {
    name: "Milky Way",
    overhang: "none",
    gloss: 0.25,
    shadow: 0.5,
    body(pen) {
      pen.body(T.galaxy);
      const r = rng(9);
      for (let i = 0; i < (pen.simple ? 14 : 30); i++) {
        const a = r() * 6.28, d = Math.sqrt(r()) * 0.95;
        pen.dot(Math.cos(a) * d, Math.sin(a) * d, 0.012 + r() * 0.02, "#ffffff", 0.6 + r() * 0.4);
      }
      for (const arm of [0, Math.PI]) {
        const sp = pen.P((b) => {
          for (let t = 0; t <= 1; t += 0.04) {
            const a = arm + t * 4.2, d = 0.12 + t * 0.78;
            const x = Math.cos(a) * d, y = Math.sin(a) * d * 0.8;
            t === 0 ? b.M(x, y) : b.L(x, y);
          }
        });
        pen.line(sp, "#7d6cf0", 0.26, 0.45);
        pen.line(sp, "#d9d0ff", 0.09, 0.85);
      }
      pen.canvas.drawCircle(0, 0, 0.36, pen.K.rad(0, 0, 0.36, ["#fff6dc", "#ffd98a", [1, 0.85, 0.5, 0]], [0, 0.4, 1]));
    },
    face: { y: 0.0, s: 0.75, ink: "#f4eaff", blush: "#ff8ac0" },
  },
].map((p) => ({ ...p, set: "cosmos" }));
