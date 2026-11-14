/**
 * #3698: Dragonfruit, redrawn from the owner's reference (the original kawaii dragonfruit).
 * Round magenta body = the collider circle; flame-shaped bracts with a pink->green base
 * gradient, a lighter green centre and a darker green outline; a crown of bracts at the top as
 * the only big overhang; side bracts peek out behind the body by a small, listed amount.
 *
 * Three takes:
 *   A "close"   - the reference's layout: 3+1 crown bracts, 6 front bracts, 4 side bracts per
 *                 side. Crown overhang 0.60 r, side overhang <= 0.13 r.
 *   B "simple"  - for 32-40 pt: 3 crown bracts, 5 bigger front bracts, 2 side bracts per side,
 *                 thicker outline, bigger face. Crown 0.45 r, sides <= 0.10 r.
 *   C "compact" - chunkier, more stylised: 3 squat crown bracts, side bracts drawn inside the
 *                 edge (no side overhang). Crown 0.35 r.
 */
import { hexA, mix } from "./styles.mjs";

export const DF = {
  body: { b: "#d93a63", l: "#f2708f", d: "#a51f51" },
  green: "#8dbb45",
  greenLight: "#acd862",
  greenDark: "#4a872b",
  pinkBase: "#dc5470",
};

/** One bract: [bx, by, w, tx, ty, notch, curl]. */
function bract(pen, s, outlineW = 0.03, opaqueBase = false) {
  const [bx, by, w, tx, ty, k = 0.4, c = 0] = s;
  const { K, canvas, P, style } = pen;
  const path = P((b) => b.bract(bx, by, w, tx, ty, k, c));
  // pink -> green along the bract axis
  const cols = [hexA(opaqueBase ? DF.body.b : DF.pinkBase, opaqueBase ? 1 : 0), hexA(mix(DF.pinkBase, DF.green, 0.55)), hexA(DF.green), hexA(DF.green)];
  const pos = [0, 0.3, 0.52, 1];
  if (style === "flat") {
    pen.grad(path, bx, by, tx, ty, [DF.pinkBase, DF.green], [0.2, 0.5]);
  } else {
    canvas.drawPath(path, K.lin(bx, by, tx, ty, cols, pos));
  }
  // lighter centre: a smaller bract inset towards the tip
  const inset = P((b) =>
    b.bract(bx + (tx - bx) * 0.3, by + (ty - by) * 0.3, w * 0.5, tx - (tx - bx) * 0.12, ty - (ty - by) * 0.12, k * 0.7, c * 0.6));
  if (style === "flat") canvas.drawPath(inset, K.fill(DF.greenLight));
  else canvas.drawPath(inset, K.lin(bx, by, tx, ty, [hexA(DF.greenLight, 0), hexA(DF.greenLight, 0), hexA(DF.greenLight)], [0, 0.4, 0.7]));
  // dark green outline, fading out at the base so the bract grows out of the skin
  const sp = K.lin(bx, by, tx, ty, [hexA(DF.greenDark, 0), hexA(DF.greenDark, style === "soft" ? 0.55 : 1), hexA(DF.greenDark, style === "soft" ? 0.55 : 1)], [0.05, 0.35, 1]);
  sp.setStyle(pen.CK.PaintStyle.Stroke);
  sp.setStrokeWidth(style === "soft" ? outlineW * 0.6 : outlineW);
  sp.setStrokeJoin(pen.CK.StrokeJoin.Round);
  canvas.drawPath(path, sp);
}

function mirror(list) {
  const out = [];
  for (const s of list) {
    out.push(s);
    if (s[0] !== 0 || s[3] !== 0) out.push([-s[0], s[1], s[2], -s[3], s[4], s[5], -(s[6] ?? 0)]);
  }
  return out;
}

const TAKES = {
  A: {
    crownBack: mirror([[-0.3, -0.72, 0.2, -0.36, -1.42, 0.35, 0.02]]).concat([[0, -0.7, 0.28, 0, -1.6, 0.35, 0]]),
    crownFront: [[0, -0.74, 0.21, 0, -1.33, 0.4, 0]],
    topFront: [[0, -0.48, 0.32, 0, -1.08, 0.34, 0]],
    side: mirror([
      [-0.48, -0.36, 0.22, -0.68, -0.97, 0.32, -0.04],
      [-0.7, 0.1, 0.22, -1.1, -0.42, 0.32, -0.04],
      [-0.7, 0.62, 0.2, -1.12, 0.28, 0.32, -0.03],
      [-0.4, 0.86, 0.16, -0.88, 0.76, 0.32, 0],
    ]),
    front: mirror([
      [-0.62, -0.3, 0.2, -0.68, -0.79, 0.32, 0.02],
      [-0.6, 0.64, 0.19, -0.7, 0.22, 0.32, 0.02],
    ]).concat([[0, 0.94, 0.3, 0, 0.48, 0.32, 0]]),
    ow: 0.03,
    face: { x: 0, y: 0.08, s: 0.92, ink: "#3a1418", blush: "#b0103c" },
  },
  B: {
    crownBack: mirror([[-0.28, -0.75, 0.22, -0.36, -1.3, 0.35, 0.03]]).concat([[0, -0.72, 0.3, 0, -1.45, 0.35, 0]]),
    crownFront: [],
    topFront: [[0, -0.5, 0.34, 0, -1.06, 0.34, 0]],
    side: mirror([
      [-0.72, 0.05, 0.22, -1.05, -0.42, 0.4, -0.03],
      [-0.72, 0.62, 0.2, -1.08, 0.24, 0.4, -0.02],
    ]),
    front: mirror([
      [-0.6, -0.28, 0.23, -0.66, -0.8, 0.32, 0.02],
      [-0.58, 0.68, 0.22, -0.68, 0.24, 0.32, 0.02],
    ]),
    ow: 0.045,
    face: { x: 0, y: 0.06, s: 1.05, ink: "#3a1418", blush: "#b0103c" },
  },
  C: {
    crownBack: mirror([[-0.3, -0.76, 0.26, -0.42, -1.22, 0.3, 0.06]]).concat([[0, -0.74, 0.32, 0, -1.35, 0.32, 0]]),
    crownFront: [],
    topFront: [[0, -0.52, 0.32, 0, -1.02, 0.34, 0]],
    side: [],
    inner: mirror([
      [-0.8, 0.05, 0.22, -0.97, -0.36, 0.42, 0],
      [-0.74, 0.66, 0.2, -0.95, 0.28, 0.42, 0],
    ]),
    front: mirror([
      [-0.5, -0.3, 0.2, -0.56, -0.74, 0.32, 0.02],
      [-0.36, 0.75, 0.2, -0.4, 0.34, 0.32, 0.02],
    ]),
    ow: 0.05,
    face: { x: 0, y: 0.06, s: 0.95, ink: "#3a1418", blush: "#b0103c" },
  },
};

export function dragonfruit(take = "A") {
  const T = TAKES[take];
  return {
    name: `Dragonfruit ${take}`,
    set: "fruits",
    face: T.face,
    back(pen) {
      for (const s of T.side) bract(pen, s, T.ow, true);
    },
    body(pen) {
      pen.body(DF.body);
      for (const s of T.inner ?? []) bract(pen, s, T.ow);
      for (const s of T.front) bract(pen, s, T.ow);
    },
    front(pen) {
      for (const s of T.crownBack) bract(pen, s, T.ow, true);
      for (const s of T.crownFront) bract(pen, s, T.ow, true);
      for (const s of T.topFront) bract(pen, s, T.ow);
    },
    overhang: { A: "crown 0.60 r up; side bracts <= 0.17 r", B: "crown 0.45 r up; sides <= 0.10 r", C: "crown 0.35 r up; none at sides" }[take],
  };
}
