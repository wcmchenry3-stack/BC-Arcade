// #3698 proposal renders. node main.mjs  -> PNGs in the scratchpad proposals3698/ folder.
import { CK, surface, save, text, image } from "./ck.mjs";
import { drawPiece, STYLES } from "../art/styles.mjs";
import { FRUITS } from "../art/fruits.mjs";
import { COSMOS } from "../art/cosmos.mjs";
import { dragonfruit } from "../art/dragonfruit.mjs";

const RAD = [18, 20, 23, 25, 28, 32, 36, 40, 45, 50, 56, 63];
const PT = 0.9; // pt per world unit on a 390-pt phone (board 360 pt)
const X3 = 3;
const SETS = { fruits: FRUITS, cosmos: COSMOS };
const THEME = {
  dark: { bg: "#0e0e13", surface: "#19191f", alt: "#1f1f26", high: "#25252c", border: "#2e2e38", text: "#e8e8f0", muted: "#a0a0ac", accent: "#8ff5ff", onAccent: "#0e0e13", header: "#1f1f26", headerText: "#e8e8f0", lid: "#a0a0ac" },
  light: { bg: "#f5ecd7", surface: "#fbf4e2", alt: "#eddfbf", high: "#fff8e8", border: "#d8c9a6", text: "#1a1412", muted: "#6b5e4a", accent: "#1bc5d4", onAccent: "#0e0e13", header: "#1a1412", headerText: "#fbf4e2", lid: "#6b5e4a" },
};
const STY = ["flat", "soft", "kawaii"];
const SHEET_TIERS = [0, 1, 2, 8, 9, 11];

const paint = (hex, a = 1) => { const p = new CK.Paint(); p.setAntiAlias(true); p.setColor(CK.Color4f(...hexRGB(hex), a)); return p; };
const strokeP = (hex, w, a = 1) => { const p = paint(hex, a); p.setStyle(CK.PaintStyle.Stroke); p.setStrokeWidth(w); return p; };
function hexRGB(h) { const n = parseInt(h.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; }
const rrect = (x, y, w, h, r) => CK.RRectXY(CK.LTRBRect(x, y, x + w, y + h), r, r);

function rng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/* ------------------------------------------------------------ settled pile */
function pile(tiers, seed) {
  const r = rng(seed);
  const W = 400, H = 600;
  const b = tiers.map((t, i) => ({ t, r: RAD[t], x: RAD[t] + r() * (W - 2 * RAD[t]), y: -i * 70, a: (r() - 0.5) * 1.2 }));
  for (let it = 0; it < 9000; it++) {
    for (const p of b) p.y += 0.5;
    for (let k = 0; k < 3; k++) {
      for (let i = 0; i < b.length; i++)
        for (let j = i + 1; j < b.length; j++) {
          const p = b[i], q = b[j];
          const dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 0.01, m = p.r + q.r - d;
          if (m > 0) {
            const ux = dx / d, uy = dy / d, wp = q.r * q.r / (p.r * p.r + q.r * q.r), wq = 1 - wp;
            p.x -= ux * m * wp; p.y -= uy * m * wp; q.x += ux * m * wq; q.y += uy * m * wq;
          }
        }
      for (const p of b) { p.x = Math.min(W - p.r, Math.max(p.r, p.x)); p.y = Math.min(H - p.r, p.y); }
    }
  }
  return b;
}
const PILE_TIERS = [11, 10, 9, 8, 7, 7, 6, 5, 5, 4, 4, 4, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 0, 0, 0, 0, 0, 6, 5, 3, 1];
const PILE = pile(PILE_TIERS, 42);

/* ------------------------------------------------------------ phone mock */
function phone(style, setName, themeName) {
  const th = THEME[themeName];
  const W = 390 * X3, H = 844 * X3;
  const { s, c } = surface(W, H, th.bg);
  c.save();
  c.scale(X3, X3);
  text(c, "9:41", 32, 32, 16, th.text, "bold");
  c.drawRect(CK.LTRBRect(0, 47, 390, 103), paint(th.header));
  c.drawPath(chev(), strokeP(th.headerText, 2.5));
  text(c, "Cascade", 195, 82, 20, th.headerText, "head", "center");
  // score row + next chip
  text(c, "SCORE", 20, 128, 11, th.muted, "bold");
  text(c, "12,480", 20, 154, 24, th.text, "head");
  text(c, "BEST", 140, 128, 11, th.muted, "bold");
  text(c, "30,215", 140, 154, 24, th.text, "head");
  c.drawRRect(rrect(292, 112, 44, 44, 10), paint(th.surface));
  c.drawRRect(rrect(292, 112, 44, 44, 10), strokeP(th.border, 1));
  c.drawRRect(rrect(340, 116, 36, 36, 9), paint(th.alt));
  c.drawRRect(rrect(340, 116, 36, 36, 9), strokeP(th.border, 1));
  const set = SETS[setName];
  c.restore();
  drawPiece(CK, c, set[1], style, 314 * X3, 134 * X3, 15 * X3, 0);
  drawPiece(CK, c, set[3], style, 358 * X3, 134 * X3, 12 * X3, 0);
  c.save();
  c.scale(X3, X3);
  // theme selector
  c.drawRRect(rrect(15, 174, 360, 38, 19), paint(th.high));
  const act = setName === "fruits" ? 0 : 1;
  c.drawRRect(rrect(19 + act * 178, 178, 174, 30, 15), paint(th.accent));
  text(c, "Fruits", 106, 198, 14, act === 0 ? th.onAccent : th.text, "bold", "center");
  text(c, "Cosmos", 284, 198, 14, act === 1 ? th.onAccent : th.text, "bold", "center");
  // board
  const bx = 15, by = 226;
  c.drawRRect(rrect(bx - 1, by - 1, 362, 542, 12), paint(th.surface));
  c.drawRRect(rrect(bx - 1, by - 1, 362, 542, 12), strokeP(th.border, 1));
  c.restore();
  c.save();
  c.clipRRect(rrect(bx * X3, by * X3, 360 * X3, 540 * X3, 11 * X3), CK.ClipOp.Intersect, true);
  const k = PT * X3;
  // lid
  c.drawLine(bx * X3, (by + 80 * PT) * X3, (bx + 360) * X3, (by + 80 * PT) * X3, strokeP(th.lid, 2 * X3, 0.9));
  for (const p of PILE) drawPiece(CK, c, set[p.t], style, bx * X3 + p.x * k, by * X3 + p.y * k, p.r * k, p.a);
  // spawner piece waiting above the lid
  drawPiece(CK, c, set[2], style, bx * X3 + 230 * k, by * X3 + 40 * k, RAD[2] * k, 0);
  c.restore();
  // home indicator
  c.drawRRect(rrect(128 * X3, 830 * X3, 134 * X3, 5 * X3, 2.5 * X3), paint(th.text, 0.85));
  return s;
}
function chev() {
  const b = new CK.PathBuilder();
  b.moveTo(30, 66); b.lineTo(22, 75); b.lineTo(30, 84);
  return b.detachAndDelete();
}

function phonePair(style, themeName) {
  const a = phone(style, "fruits", themeName).makeImageSnapshot();
  const b = phone(style, "cosmos", themeName).makeImageSnapshot();
  const gap = 60, head = 150;
  const { s, c } = surface(a.width() * 2 + gap * 3, a.height() + head + gap, themeName === "dark" ? "#000000" : "#e6dcc4");
  const ink = themeName === "dark" ? "#e8e8f0" : "#1a1412";
  text(c, `${STYLES[style].title}  ·  ${themeName} theme  ·  390×844 pt @3x, pieces at true size`, gap, 70, 46, ink, "head");
  text(c, STYLES[style].blurb, gap, 125, 30, ink, "body");
  c.drawImage(a, gap, head);
  c.drawImage(b, gap * 2 + a.width(), head);
  return s;
}

/* ------------------------------------------------------------ sheets */
function sheet6(style) {
  const cell = 330, R = 108, gy = 120;
  const W = cell * 6 + 80, H = 150 + (cell + 80) * 2 + 40 + 2 * 470 + 20;
  const { s, c } = surface(W, H, "#19191f");
  text(c, STYLES[style].title, 40, 70, 46, "#e8e8f0", "head");
  text(c, STYLES[style].blurb, 40, 112, 26, "#a0a0ac", "body");
  let y = 150;
  for (const setName of ["fruits", "cosmos"]) {
    SHEET_TIERS.forEach((t, i) => {
      const p = SETS[setName][t];
      drawPiece(CK, c, p, style, 40 + cell * i + cell / 2, y + cell / 2 + 20, R, 0);
      text(c, `${t} · ${p.name}`, 40 + cell * i + cell / 2, y + cell + 30, 24, "#e8e8f0", "bold", "center");
      text(c, p.overhang === "none" ? "no overhang" : p.overhang, 40 + cell * i + cell / 2, y + cell + 58, 17, "#a0a0ac", "body", "center");
    });
    y += cell + 80;
  }
  // true-size strip (3x) on the bin colour
  text(c, "Game size (true size on a 390-pt phone, rendered @3x), dark bin:", 40, y + 10, 26, "#e8e8f0", "bold");
  y += 30;
  for (const setName of ["fruits", "cosmos"]) {
    c.drawRRect(rrect(40, y, W - 80, 450, 18), paint("#19191f"));
    c.drawRRect(rrect(40, y, W - 80, 450, 18), strokeP("#2e2e38", 3));
    let x = 110;
    SHEET_TIERS.forEach((t) => {
      const r = RAD[t] * PT * X3;
      drawPiece(CK, c, SETS[setName][t], style, x + r, y + 430 - r, r, 0);
      x += 2 * r + 110;
    });
    y += 470;
  }
  return s;
}

/* ------------------------------------------------------------ colour blind */
const CB = {
  deuteranopia: [0.367322, 0.860646, -0.227968, 0.280085, 0.672501, 0.047413, -0.01182, 0.04294, 0.968881],
  protanopia: [0.152286, 1.052583, -0.204868, 0.114503, 0.786281, 0.099216, -0.003882, -0.048116, 1.051998],
};
function cbFilter(m) {
  const mat = CK.ColorFilter.MakeMatrix([m[0], m[1], m[2], 0, 0, m[3], m[4], m[5], 0, 0, m[6], m[7], m[8], 0, 0, 0, 0, 0, 1, 0]);
  return CK.ColorFilter.MakeCompose(CK.ColorFilter.MakeLinearToSRGBGamma(), CK.ColorFilter.MakeCompose(mat, CK.ColorFilter.MakeSRGBToLinearGamma()));
}
function cbStrip(style) {
  const groups = [["cosmos", [0, 1, 2]], ["fruits", [4, 5, 6]], ["cosmos", [6, 7]]];
  // row of pieces at 2x game size on dark bin
  const k = PT * X3;
  const rowW = 2200, rowH = 250;
  const { s: rs, c: rc } = surface(rowW, rowH, "#19191f");
  let x = 40;
  groups.forEach(([set, tiers], gi) => {
    tiers.forEach((t) => {
      const r = RAD[t] * k;
      drawPiece(CK, rc, SETS[set][t], style, x + r, 135, r, 0);
      text(rc, SETS[set][t].name, x + r, 245, 22, "#a0a0ac", "body", "center");
      x += 2 * r + 40;
    });
    if (gi < groups.length - 1) { rc.drawLine(x + 10, 30, x + 10, 220, strokeP("#2e2e38", 3)); x += 60; }
  });
  const row = rs.makeImageSnapshot();
  const W = rowW + 360, H = 90 + 3 * (rowH + 20);
  const { s, c } = surface(W, H, "#0e0e13");
  text(c, `${STYLES[style].title} · colour-blind check (Machado 2009, full severity, linear RGB) · true size @3x`, 30, 55, 32, "#e8e8f0", "head");
  [["normal", null], ["deuteranopia", CB.deuteranopia], ["protanopia", CB.protanopia]].forEach(([label, m], i) => {
    const y = 90 + i * (rowH + 20);
    text(c, label, 30, y + rowH / 2 + 10, 30, "#e8e8f0", "bold");
    const p = new CK.Paint();
    if (m) p.setColorFilter(cbFilter(m));
    c.drawImage(row, 330, y, p);
  });
  return s;
}

/* ------------------------------------------------------------ dragonfruit */
function dragonSheet() {
  const ref = image("/tmp/claude-0/-home-user-BC-Arcade/44eba4e8-df7f-57d0-86bb-989fc05932a9/scratchpad/df_ref_cut.png");
  // crop of the original around the fruit; its round body is centred at (0.4718, 0.6345) of the crop
  const SRC = CK.LTRBRect(393, 186, 1677, 1842), sw = 1284, sh = 1656;
  const ph = 640, pw = (sw * ph) / sh, R = 463.7 * (ph / sh); // body radius in the panel (~179 px)
  const cell = 640, W = cell * 4 + 80, top = 110, H = top + ph + 130 + 430 + 40;
  const { s, c } = surface(W, H, "#ffffff");
  text(c, "Dragonfruit · the original (left) vs three code redraws (kawaii), same body size; body = collider circle", 40, 70, 36, "#1a1412", "head");
  const ox = 40 + (cell - pw) / 2;
  c.drawImageRect(ref, SRC, CK.LTRBRect(ox, top, ox + pw, top + ph), new CK.Paint(), true);
  const cy = top + 0.6345 * ph;
  const labels = {
    A: ["A · close match", "crown overhang 0.60 r up, side bracts ≤ 0.17 r"],
    B: ["B · simplified for game size", "crown 0.45 r up, side bracts ≤ 0.10 r"],
    C: ["C · compact", "crown 0.35 r up, no side overhang"],
  };
  text(c, "Original (Gemini raster)", 40 + cell / 2, top + ph + 40, 26, "#1a1412", "bold", "center");
  text(c, "body radius ≈ 0.23 of the image; crown ≈ 1.2 r above the body", 40 + cell / 2, top + ph + 74, 20, "#6b5e4a", "body", "center");
  ["A", "B", "C"].forEach((t, i) => {
    const cx = 40 + cell * (i + 1) + cell / 2;
    drawPiece(CK, c, dragonfruit(t), "kawaii", cx, cy, R, 0);
    c.drawCircle(cx, cy, R, strokeP("#1bc5d4", 2, 0.7)); // collider
    text(c, labels[t][0], cx, top + ph + 40, 26, "#1a1412", "bold", "center");
    text(c, labels[t][1], cx, top + ph + 74, 20, "#6b5e4a", "body", "center");
  });
  text(c, "Thin teal circle = the collider (tier 8, radius 45 units). Everything outside it is the listed overhang.", 40, top + ph + 112, 20, "#6b5e4a", "body");
  const y0 = top + ph + 130;
  c.drawRRect(rrect(40, y0, W - 80, 430, 24), paint("#19191f"));
  text(c, "Game size, dark bin, @3x: tier 8 = radius 45 units × 0.9 = 81 pt across. Peach (left) and Blueberry (right) touch its collider.", 560, y0 + 44, 22, "#a0a0ac", "body");
  const k = PT * X3, r8 = 45 * k;
  ["ref", "A", "B", "C"].forEach((t, i) => {
    const cx = 40 + ((W - 80) / 4) * i + 330, cyy = y0 + 250;
    if (t === "ref") {
      const sc = r8 / 463.7;
      c.drawImageRect(ref, SRC, CK.LTRBRect(cx - 0.4718 * sw * sc, cyy - 0.6345 * sh * sc, cx + 0.5282 * sw * sc, cyy + 0.3655 * sh * sc), new CK.Paint(), true);
    } else drawPiece(CK, c, dragonfruit(t), "kawaii", cx, cyy, r8, 0);
    const rp = 36 * k, rb = 20 * k;
    drawPiece(CK, c, FRUITS[6], "kawaii", cx - r8 - rp, cyy + r8 - rp, rp, 0.2);
    drawPiece(CK, c, FRUITS[1], "kawaii", cx + (r8 + rb) * 0.8, cyy + Math.sqrt((r8 + rb) ** 2 - ((r8 + rb) * 0.8) ** 2), rb, -0.3);
    text(c, t === "ref" ? "original" : t, cx, y0 + 415, 26, "#e8e8f0", "bold", "center");
  });
  return s;
}

/* ------------------------------------------------------------ run */
const sizes = {};
const out = (s, name) => (sizes[name] = save(s, name));
for (const st of STY) {
  out(sheet6(st), `${STY.indexOf(st) + 1}_${st}_sheet6.png`);
  out(phonePair(st, "dark"), `${STY.indexOf(st) + 1}_${st}_mock_dark.png`);
  out(phonePair(st, "light"), `${STY.indexOf(st) + 1}_${st}_mock_light.png`);
  out(cbStrip(st), `${STY.indexOf(st) + 1}_${st}_colourblind.png`);
}
// combined side by side: fruits + cosmos dark phones per style, at 1.5x
{
  const sc = 0.5, pw = 390 * X3 * sc, ph = 844 * X3 * sc, gap = 40, head = 120;
  const W = (pw * 2 + gap) * 3 + gap * 4, H = ph + head + 2 * gap;
  const { s, c } = surface(W, H, "#000000");
  STY.forEach((st, i) => {
    const x0 = gap + i * (pw * 2 + gap * 2);
    text(c, STYLES[st].title, x0, 60, 40, "#e8e8f0", "head");
    ["fruits", "cosmos"].forEach((set, j) => {
      const img = phone(st, set, "dark").makeImageSnapshot();
      c.drawImageRect(img, CK.LTRBRect(0, 0, img.width(), img.height()), CK.LTRBRect(x0 + j * (pw + gap), head, x0 + j * (pw + gap) + pw, head + ph), new CK.Paint(), true);
    });
  });
  out(s, "0_compare_mocks_dark.png");
}
out(dragonSheet(), "4_dragonfruit_takes.png");
console.log(sizes);
