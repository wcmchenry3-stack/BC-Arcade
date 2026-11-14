/**
 * #3698 proposal: the Fruits set as small descriptions in unit space (collider radius 1,
 * centre 0,0, y down). `body` is clipped to the circle; `back` / `front` are the only things
 * drawn outside it (overhangs, listed per piece). Colours here move to theme.cascade.ts.
 */
import { dragonfruit } from "./dragonfruit.mjs";

const T = {
  cherry: { b: "#d81e3a", l: "#ff5a6e", d: "#8a0b20", o: "#6e0718" },
  blue: { b: "#3f55b8", l: "#7d93ea", d: "#1f2b6e", o: "#18204f" },
  lemon: { b: "#f7d531", l: "#fff08a", d: "#c9a20a", o: "#9c7a06" },
  grapeBg: { b: "#3e1a5e", l: "#5a2a84", d: "#24103a" },
  grape: { b: "#8a45c0", l: "#c08aec", d: "#55237e", o: "#3b145c" },
  orange: { b: "#f58a1f", l: "#ffb766", d: "#c2560a", o: "#8f3c05" },
  apple: { b: "#c8102e", l: "#f2505e", d: "#7a0616", o: "#5e0411" },
  peach: { b: "#ffb27a", l: "#ffd9b0", d: "#e46a4e", o: "#b8452f" },
  coconut: { b: "#6e4426", l: "#9b6b44", d: "#3e2312", o: "#2b170b" },
  pine: { b: "#f3b52a", l: "#ffdc72", d: "#bb7a14", o: "#8a5508" },
  melon: { b: "#2f9a3e", l: "#6bd06a", d: "#17602a", o: "#0f4a1f" },
  pumpkin: { b: "#f27a1a", l: "#ffab4e", d: "#b44a08", o: "#843405" },
  leaf: { b: "#4fae3c", l: "#8ad66a", d: "#2c7424", o: "#1e5418" },
  stem: { b: "#7a4a22", l: "#a46c3c", d: "#4a2a10", o: "#3a1f0a" },
  pStem: { b: "#6d7d2c", l: "#9aac4c", d: "#465316", o: "#334010" },
};

/** Deterministic RNG so every render is identical. */
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

const stemLeaf = (pen, sx, sy, ex, ey, leaf) => {
  pen.line(pen.P((b) => b.M(sx, sy).Q(sx + 0.02, (sy + ey) / 2, ex, ey)), pen.style === "kawaii" ? T.stem.o : T.stem.b, pen.style === "kawaii" ? 0.2 : 0.13);
  if (pen.style === "kawaii") pen.line(pen.P((b) => b.M(sx, sy).Q(sx + 0.02, (sy + ey) / 2, ex, ey)), T.stem.b, 0.1);
  if (leaf) {
    const [x0, y0, x1, y1, w] = leaf;
    pen.over(pen.P((b) => b.leaf(x0, y0, x1, y1, w)), T.leaf);
    pen.line(pen.P((b) => b.M(x0, y0).Q((x0 + x1) / 2, (y0 + y1) / 2 + 0.02, x0 + (x1 - x0) * 0.8, y0 + (y1 - y0) * 0.8)), T.leaf.d, 0.035, 0.8);
  }
};

export const FRUITS = [
  {
    name: "Cherry",
    overhang: "stem + leaf, up to 0.45 r above",
    body(pen) {
      pen.body(T.cherry);
      pen.line(pen.P((b) => b.M(-0.12, -0.86).Q(0.05, -0.74, 0.2, -0.86)), T.cherry.d, 0.07, 0.8);
    },
    front(pen) {
      stemLeaf(pen, 0.04, -0.82, 0.28, -1.42, [0.22, -1.3, 0.78, -1.2, 0.17]);
    },
    face: { y: 0.12, s: 0.95 },
  },
  {
    name: "Blueberry",
    overhang: "none",
    body(pen) {
      pen.body(T.blue);
      if (!pen.simple) pen.dot(0.1, 0.2, 0.75, "#b9c6ff", 0.12); // bloom
      const cx = 0.02, cy = -0.5, r = 0.27;
      const star = pen.P((b) => {
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2 - Math.PI / 2;
          b.M(cx, cy).L(cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.75);
        }
      });
      pen.line(star, T.blue.o, 0.13);
      pen.dot(cx, cy, 0.09, "#141a3e");
    },
    face: { y: 0.18, s: 0.95, ink: "#0f1330" },
  },
  {
    name: "Lemon",
    overhang: "two nubs, 0.17 r, on the diagonal",
    back(pen) {
      pen.over(pen.P((b) => b.circ(0.71, -0.71, 0.24)), T.lemon);
      pen.over(pen.P((b) => b.circ(-0.71, 0.71, 0.24)), T.lemon);
    },
    body(pen) {
      pen.body(T.lemon);
      if (!pen.simple) {
        const r = rng(3);
        for (let i = 0; i < 26; i++) {
          const a = r() * 6.28, d = Math.sqrt(r()) * 0.85;
          pen.dot(Math.cos(a) * d, Math.sin(a) * d, 0.025, T.lemon.d, 0.35);
        }
      }
      pen.line(pen.P((b) => b.M(0.62, -0.62).L(0.75, -0.75)), T.lemon.d, 0.06, 0.6);
    },
    face: { s: 0.95, ink: "#4a3205" },
  },
  {
    name: "Grape",
    overhang: "stem, 0.3 r above",
    body(pen) {
      pen.body(T.grapeBg);
      const g = [
        [-0.5, -0.5], [0, -0.58], [0.5, -0.5],
        [-0.72, 0.02], [-0.25, -0.08], [0.25, -0.08], [0.72, 0.02],
        [-0.45, 0.45], [0, 0.4], [0.45, 0.45],
        [-0.2, 0.85], [0.22, 0.85],
      ];
      for (const [x, y] of g) pen.ball(x, y, 0.3, T.grape);
    },
    front(pen) {
      stemLeaf(pen, 0, -0.85, 0.1, -1.3);
    },
    face: { y: 0.1, s: 0.9, ink: "#1c0830" },
  },
  {
    name: "Orange",
    overhang: "none",
    body(pen) {
      pen.body(T.orange);
      if (!pen.simple) {
        for (let y = -0.8; y <= 0.9; y += 0.2)
          for (let x = -0.9; x <= 0.9; x += 0.2) {
            const ox = x + ((Math.round(y * 5) & 1) ? 0.1 : 0);
            if (ox * ox + y * y < 0.85) pen.dot(ox, y, 0.03, T.orange.d, 0.35);
          }
      }
      const cx = 0, cy = -0.62;
      pen.line(pen.P((b) => { for (let i = 0; i < 5; i++) { const a = (i / 5) * 6.283 - 1.571; b.M(cx, cy).L(cx + Math.cos(a) * 0.13, cy + Math.sin(a) * 0.1); } }), "#3f8a2a", 0.07);
      pen.dot(cx, cy, 0.05, "#2c6a1c");
    },
    face: { y: 0.1, ink: "#4a2003" },
  },
  {
    name: "Apple",
    overhang: "stem + leaf, up to 0.35 r above",
    body(pen) {
      pen.body(T.apple);
      if (!pen.simple) for (const x of [-0.45, -0.2, 0.3, 0.55]) pen.line(pen.P((b) => b.M(x, -0.6).Q(x * 1.2, 0, x, 0.7)), "#ffd36b", 0.035, 0.18);
      pen.line(pen.P((b) => b.M(-0.22, -0.84).Q(0, -0.7, 0.22, -0.84)), T.apple.d, 0.08, 0.9);
    },
    front(pen) {
      stemLeaf(pen, 0, -0.8, 0.07, -1.3, [0.07, -1.12, 0.62, -1.3, 0.15]);
    },
    face: { y: 0.1, ink: "#3a0208" },
  },
  {
    name: "Peach",
    overhang: "leaf, 0.3 r above-left",
    body(pen) {
      pen.body(T.peach);
      pen.fill(pen.P((b) => b.blob([[0.05, -0.9], [0.7, -0.6], [0.95, 0.1], [0.6, 0.8], [0.1, 0.6], [0.0, 0.0]])), { b: "#f2706a", l: "#ff9b8a", d: "#d24c4a" }, 0.75);
      pen.line(pen.P((b) => b.M(0.02, -0.95).C(-0.25, -0.5, -0.25, 0.2, 0.0, 0.62)), T.peach.o, 0.07, 0.75);
    },
    front(pen) {
      pen.over(pen.P((b) => b.leaf(-0.02, -0.92, -0.62, -1.24, 0.15)), T.leaf);
      pen.line(pen.P((b) => b.M(-0.02, -0.92).L(-0.48, -1.16)), T.leaf.d, 0.035, 0.8);
    },
    face: { y: 0.12, ink: "#5a1a0c" },
  },
  {
    name: "Coconut",
    overhang: "none",
    body(pen) {
      pen.body(T.coconut);
      const r = rng(7);
      const n = pen.simple ? 9 : 22;
      for (let i = 0; i < n; i++) {
        const a = r() * 6.28, d = 0.25 + r() * 0.65;
        const x = Math.cos(a) * d, y = Math.sin(a) * d, t = a + 1.4 + (r() - 0.5) * 0.6;
        pen.line(pen.P((b) => b.M(x, y).L(x + Math.cos(t) * 0.2, y + Math.sin(t) * 0.2)), T.coconut.l, 0.045, 0.7);
      }
      for (const [x, y] of [[-0.2, -0.5], [0.2, -0.5], [0, -0.22]]) pen.dot(x, y, 0.1, "#24130a");
    },
    face: { y: 0.3, s: 0.9, ink: "#1a0c04" },
  },
  { ...dragonfruit("A"), name: "Dragonfruit" },
  {
    name: "Pineapple",
    overhang: "crown of 5 leaves, 0.42 r above",
    body(pen) {
      pen.body(T.pine);
      const step = pen.simple ? 0.42 : 0.3;
      const ln = pen.P((b) => {
        for (let k = -2.4; k <= 2.4; k += step) {
          b.M(k - 1, -1).L(k + 1, 1);
          b.M(k + 1, -1).L(k - 1, 1);
        }
      });
      pen.line(ln, T.pine.d, pen.simple ? 0.07 : 0.05, 0.85);
      if (!pen.simple)
        for (let i = -6; i <= 6; i++)
          for (let j = -6; j <= 6; j++) {
            const x = (i + j) * 0.15, y = (j - i) * 0.15 + 0.15;
            if (x * x + y * y < 0.9) pen.line(pen.P((b) => b.M(x - 0.03, y + 0.02).L(x + 0.03, y - 0.02)), "#8a5508", 0.045, 0.8);
          }
    },
    front(pen) {
      const lv = [[-0.42, -1.2], [0.42, -1.2], [-0.2, -1.36], [0.2, -1.36], [0, -1.42]];
      for (const [x, y] of lv) pen.over(pen.P((b) => b.leaf(x * 0.25, -0.8, x, y, 0.13)), { b: "#3f9a3a", l: "#77c95a", d: "#1f6022", o: "#174a1a" });
    },
    face: { y: 0.15, ink: "#4a2a02" },
  },
  {
    name: "Watermelon",
    overhang: "none",
    body(pen) {
      pen.body(T.melon);
      for (const s of pen.simple ? [-0.9, -0.5, 0.5, 0.9] : [-0.9, -0.45, 0, 0.45, 0.9]) {
        const p = pen.P((b) => {
          b.M(s * 0.05, -1.05);
          for (let y = -1; y <= 1.05; y += 0.1) {
            const w = Math.sqrt(Math.max(0, 1 - y * y));
            b.L(s * w + Math.sin(y * 14 + s * 3) * 0.04, y);
          }
        });
        pen.line(p, T.melon.o, pen.simple ? 0.16 : 0.13, 0.9);
      }
    },
    face: { y: 0.1, ink: "#0a2a10" },
  },
  {
    name: "Pumpkin",
    overhang: "stem, 0.3 r above",
    body(pen) {
      pen.body(T.pumpkin);
      for (const s of [-0.62, -0.25, 0.25, 0.62]) {
        const p = pen.P((b) => {
          b.M(s * 0.25, -0.92);
          b.Q(s * 1.45, 0, s * 0.25, 0.95);
        });
        pen.line(p, T.pumpkin.d, 0.08, 0.75);
      }
      if (!pen.simple) for (const s of [-0.44, 0, 0.44]) pen.line(pen.P((b) => b.M(s * 0.3, -0.7).Q(s * 1.35, 0, s * 0.3, 0.75)), T.pumpkin.l, 0.09, 0.35);
    },
    front(pen) {
      pen.over(pen.P((b) => b.M(-0.12, -0.84).Q(-0.12, -1.12, -0.02, -1.28).Q(0.12, -1.34, 0.2, -1.22).Q(0.08, -1.08, 0.12, -0.84).Z()), T.pStem);
    },
    face: { y: 0.1, ink: "#4a1a02" },
  },
].map((p) => ({ ...p, set: "fruits" }));
