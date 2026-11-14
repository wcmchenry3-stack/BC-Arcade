/**
 * #3698 proposal: the three candidate styles as "pens". A piece description (fruits.mjs /
 * cosmos.mjs) says WHAT is on the piece in unit space (centre 0,0, collider radius 1, y down);
 * the pen decides HOW it is painted. Only paths, linear/radial gradients, circles and strokes:
 * everything maps 1:1 to react-native-skia (Skia.Path / Skia.Shader.MakeLinearGradient /
 * MakeRadialGradient). No mask filters, no blur.
 *
 *   flat   - solid fills, a hard cel shadow crescent and a crisp round-capped highlight arc.
 *   soft   - volumetric "clean modern": gradient body, edge occlusion and soft specular, all
 *            inside the circle; lighting is drawn unrotated so it stays top-left as pieces roll.
 *   kawaii - glossy sticker look of the owner's dragonfruit: gradient body with a darker rim,
 *            outlined features, two specular dots, faces (fruits open eyes, cosmos closed + blush).
 */

export function hexA(hex, a = 1) {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, a];
}
export function mix(h1, h2, t) {
  const a = hexA(h1), b = hexA(h2);
  const c = a.map((v, i) => Math.round((v + (b[i] - v) * t) * 255));
  return "#" + c.slice(0, 3).map((v) => v.toString(16).padStart(2, "0")).join("");
}

/** Path builder over CanvasKit (in the app: Skia.Path.Make()). */
export function pathKit(CK) {
  return function P(fn) {
    const p = new CK.PathBuilder();
    const b = {
      M: (x, y) => (p.moveTo(x, y), b),
      L: (x, y) => (p.lineTo(x, y), b),
      Q: (a, c, x, y) => (p.quadTo(a, c, x, y), b),
      C: (a, c, d, e, x, y) => (p.cubicTo(a, c, d, e, x, y), b),
      Z: () => (p.close(), b),
      circ: (x, y, r) => (p.addCircle(x, y, r), b),
      oval: (x, y, rx, ry) => (p.addOval(CK.LTRBRect(x - rx, y - ry, x + rx, y + ry)), b),
      arc: (x, y, rx, ry, s, sw) =>
        (p.addArc(CK.LTRBRect(x - rx, y - ry, x + rx, y + ry), s, sw), b),
      /** Smooth closed blob through points (Catmull-Rom). */
      blob: (pts) => {
        const n = pts.length;
        p.moveTo(pts[0][0], pts[0][1]);
        for (let i = 0; i < n; i++) {
          const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
          p.cubicTo(
            p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6,
            p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6, p2[0], p2[1]);
        }
        p.close();
        return b;
      },
      /** Plump leaf with rounded ends from (x0,y0) to (x1,y1); w = half width. */
      leaf: (x0, y0, x1, y1, w) => {
        const dx = x1 - x0, dy = y1 - y0, l = Math.hypot(dx, dy), tx = dx / l, ty = dy / l;
        const nx = -ty * w, ny = tx * w;
        p.moveTo(x0, y0);
        p.cubicTo(x0 + nx * 1.3 + tx * l * 0.2, y0 + ny * 1.3 + ty * l * 0.2,
          x1 + nx * 0.5 - tx * l * 0.1, y1 + ny * 0.5 - ty * l * 0.1, x1, y1);
        p.cubicTo(x1 - nx * 0.5 - tx * l * 0.1, y1 - ny * 0.5 - ty * l * 0.1,
          x0 - nx * 1.3 + tx * l * 0.2, y0 - ny * 1.3 + ty * l * 0.2, x0, y0);
        p.close();
        return b;
      },
      /**
       * Dragonfruit bract: a flame/arch with a rounded-pointed tip and a concave base notch
       * (the "^" shape of the reference). Base centre (bx,by), half width w, tip (tx,ty),
       * notch depth k (0..1 of the height), tip curl c (sideways).
       */
      bract: (bx, by, w, tx, ty, k = 0.32, c = 0) => {
        const hx = tx - bx, hy = ty - by; // base -> tip
        const L = Math.hypot(hx, hy), ux = hx / L, uy = hy / L, nx = -uy, ny = ux;
        const lx = bx - nx * w, ly = by - ny * w, rx = bx + nx * w, ry = by + ny * w;
        const ix = bx + ux * L * k, iy = by + uy * L * k; // notch apex
        const t0 = tx + nx * c, t1 = ty + ny * c;
        p.moveTo(lx, ly);
        p.cubicTo(lx - nx * w * 0.1 + ux * L * 0.5, ly - ny * w * 0.1 + uy * L * 0.5,
          t0 - nx * w * 0.28 - ux * L * 0.3, t1 - ny * w * 0.28 - uy * L * 0.3, t0, t1);
        p.cubicTo(t0 + nx * w * 0.28 - ux * L * 0.3, t1 + ny * w * 0.28 - uy * L * 0.3,
          rx + nx * w * 0.1 + ux * L * 0.5, ry + ny * w * 0.1 + uy * L * 0.5, rx, ry);
        p.quadTo(bx + nx * w * 0.3 + ux * L * k * 0.25, by + ny * w * 0.3 + uy * L * k * 0.25, ix, iy);
        p.quadTo(bx - nx * w * 0.3 + ux * L * k * 0.25, by - ny * w * 0.3 + uy * L * k * 0.25, lx, ly);
        p.close();
        return b;
      },
    };
    fn(b);
    return p.detachAndDelete();
  };
}

function makePaints(CK) {
  const fill = (hex, a = 1) => {
    const p = new CK.Paint();
    p.setAntiAlias(true);
    p.setColor(hexA(hex, a));
    return p;
  };
  const stroke = (hex, w, a = 1) => {
    const p = fill(hex, a);
    p.setStyle(CK.PaintStyle.Stroke);
    p.setStrokeWidth(w);
    p.setStrokeCap(CK.StrokeCap.Round);
    p.setStrokeJoin(CK.StrokeJoin.Round);
    return p;
  };
  const lin = (x0, y0, x1, y1, cols, pos) => {
    const p = new CK.Paint();
    p.setAntiAlias(true);
    p.setShader(CK.Shader.MakeLinearGradient([x0, y0], [x1, y1],
      cols.map((c) => (Array.isArray(c) ? c : hexA(c))), pos, CK.TileMode.Clamp));
    return p;
  };
  const rad = (x, y, r, cols, pos) => {
    const p = new CK.Paint();
    p.setAntiAlias(true);
    p.setShader(CK.Shader.MakeRadialGradient([x, y], r,
      cols.map((c) => (Array.isArray(c) ? c : hexA(c))), pos, CK.TileMode.Clamp));
    return p;
  };
  return { fill, stroke, lin, rad };
}

/* ------------------------------------------------------------------ styles */

export const STYLES = {
  flat: {
    name: "flat",
    title: "1 · Flat + crisp highlight",
    blurb: "Solid colours, one hard shadow crescent, one crisp highlight stroke. Cheapest and sharpest at 32 pt; least depth on the big tiers.",
  },
  soft: {
    name: "soft",
    title: "2 · Soft-shaded clean modern",
    blurb: "Volumetric gradients, edge occlusion and a soft specular, all inside the circle; light stays top-left as pieces roll. Richest look; small-tier details soften.",
  },
  kawaii: {
    name: "kawaii",
    title: "3 · Kawaii glossy sticker",
    blurb: "The owner's dragonfruit language: glossy gradient body, darker rim, outlined features, two specular dots, faces. Most character; faces cover surface detail.",
  },
};

/**
 * Make a pen for one style on one canvas. The canvas is already transformed to unit space.
 */
export function makePen(CK, canvas, styleName) {
  const P = pathKit(CK);
  const K = makePaints(CK);
  const s = styleName;
  const pen = {
    P,
    style: s,
    simple: s === "kawaii",
    canvas,
    body(t) {
      if (s === "flat") canvas.drawCircle(0, 0, 1, K.fill(t.b));
      else if (s === "soft") canvas.drawCircle(0, 0, 1, K.rad(-0.35, -0.42, 1.55, [t.l, t.b, t.d], [0, 0.42, 1]));
      else canvas.drawCircle(0, 0, 1, K.rad(-0.25, -0.35, 1.35, [mix(t.l, t.b, 0.25), t.b, t.d], [0, 0.55, 1]));
    },
    fill(path, t, a = 1) {
      if (s === "soft" && t.l) {
        const r = path.getBounds();
        const p = K.lin(r[0], r[1], r[2], r[3], [hexA(mix(t.l, t.b, 0.4), a), hexA(t.b, a), hexA(mix(t.b, t.d, 0.6), a)], [0, 0.5, 1]);
        canvas.drawPath(path, p);
      } else canvas.drawPath(path, K.fill(t.b ?? t, a));
      if (s === "kawaii" && t.o) canvas.drawPath(path, K.stroke(t.o, 0.035));
    },
    /** A small sphere inside the piece (grapes). */
    ball(x, y, r, t) {
      if (s === "soft") canvas.drawCircle(x, y, r, K.rad(x - r * 0.35, y - r * 0.4, r * 1.5, [t.l, t.b, t.d], [0, 0.45, 1]));
      else {
        canvas.drawCircle(x, y, r, K.fill(t.b));
        if (s === "flat") {
          const sh = CK.Path.MakeFromOp(P((b) => b.circ(x, y, r)), P((b) => b.circ(x - r * 0.25, y - r * 0.25, r)), CK.PathOp.Difference);
          canvas.drawPath(sh, K.fill(t.d, 0.8));
        }
        if (s === "kawaii") canvas.drawCircle(x, y, r - 0.015, K.stroke(t.d, 0.03));
        canvas.drawCircle(x - r * 0.38, y - r * 0.38, r * 0.2, K.fill("#ffffff", s === "flat" ? 0.85 : 0.7));
      }
    },
    crater(x, y, r, t) {
      if (s === "soft") {
        canvas.drawCircle(x, y, r, K.rad(x - r * 0.35, y - r * 0.35, r * 1.45, [t.d, t.b, t.l], [0, 0.55, 1]));
      } else if (s === "flat") {
        canvas.drawCircle(x, y, r, K.fill(t.l));
        canvas.drawCircle(x - r * 0.14, y - r * 0.14, r * 0.86, K.fill(t.d));
      } else canvas.drawCircle(x, y, r, K.fill(t.d, 0.7));
    },
    line(path, color, w, a = 1) {
      canvas.drawPath(path, K.stroke(color, w, a));
    },
    dot(x, y, r, color, a = 1) {
      canvas.drawCircle(x, y, r, K.fill(color, a));
    },
    /** Overhang shape (leaf, stem, crown): never clipped. */
    over(path, t) {
      if (s === "soft") {
        const r = path.getBounds();
        canvas.drawPath(path, K.lin(r[0], r[1], r[2], r[3], [t.l, t.b, t.d], [0, 0.45, 1]));
      } else canvas.drawPath(path, K.fill(t.b));
      if (s === "kawaii") canvas.drawPath(path, K.stroke(t.o ?? t.d, 0.06));
      if (s === "flat" && t.d) canvas.drawPath(path, K.stroke(t.d, 0.025));
    },
    /** Plain linear gradient fill (two or more stops), same in every style except flat, which steps it. */
    grad(path, x0, y0, x1, y1, cols, pos) {
      if (s === "flat") {
        const hard = [];
        const hp = [];
        cols.forEach((c, i) => {
          if (i) { hard.push(cols[i - 1 + 0], c); const m = (pos[i - 1] + pos[i]) / 2; hp.push(m, m); }
        });
        canvas.drawPath(path, K.lin(x0, y0, x1, y1, [cols[0], ...hard, cols[cols.length - 1]], [0, ...hp, 1]));
      } else canvas.drawPath(path, K.lin(x0, y0, x1, y1, cols, pos));
    },
    outline(path, color, w) {
      if (s === "soft") canvas.drawPath(path, K.stroke(color, w * 0.6, 0.6));
      else canvas.drawPath(path, K.stroke(color, s === "kawaii" ? w * 1.15 : w * 0.8));
    },
    K,
    CK,
  };
  return pen;
}

/**
 * Lighting drawn over a piece, inside its circle, unrotated (the piece's features rotate with
 * physics; the light does not). `gloss` (0..1) dims it for emissive / dark pieces.
 */
export function drawLight(CK, canvas, styleName, piece) {
  const K = makePaints(CK);
  const P = pathKit(CK);
  const g = piece.gloss ?? 1;
  if (styleName === "flat") {
    const cres = CK.Path.MakeFromOp(P((b) => b.circ(0, 0, 1)), P((b) => b.circ(-0.17, -0.2, 1.02)), CK.PathOp.Difference);
    canvas.drawPath(cres, K.fill("#000000", 0.17 * (piece.shadow ?? 1)));
    const hl = P((b) => b.arc(0, 0, 0.72, 0.72, 196, 52));
    canvas.drawPath(hl, K.stroke("#ffffff", 0.11, 0.8 * g));
    canvas.drawCircle(Math.cos((262 * Math.PI) / 180) * 0.72, Math.sin((262 * Math.PI) / 180) * 0.72, 0.055, K.fill("#ffffff", 0.8 * g));
  } else if (styleName === "soft") {
    canvas.drawCircle(0, 0, 1, K.rad(0.12, 0.15, 1.12, [[0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0.32 * (piece.shadow ?? 1)]], [0, 0.66, 1]));
    canvas.drawCircle(0, 0, 1, K.rad(-0.4, -0.45, 0.62, [[1, 1, 1, 0.5 * g], [1, 1, 1, 0.16 * g], [1, 1, 1, 0]], [0, 0.4, 1]));
    // thin rim light, bottom-right, inside the edge
    canvas.drawPath(P((b) => b.arc(0, 0, 0.94, 0.94, 10, 70)), K.stroke("#ffffff", 0.05, 0.18 * g));
  } else {
    // kawaii: darker rim inside the edge, soft gloss blob, two specular dots (the reference)
    canvas.drawCircle(0, 0, 1, K.rad(0, 0, 1, [[0, 0, 0, 0], [0, 0, 0, 0], [0.25, 0, 0.1, 0.22 * (piece.shadow ?? 1)]], [0, 0.86, 1]));
    canvas.drawCircle(-0.36, -0.42, 0.42, K.rad(-0.36, -0.42, 0.42, [[1, 1, 1, 0.2 * g], [1, 1, 1, 0]], [0, 1]));
    canvas.save();
    canvas.rotate(-35, -0.47, -0.62);
    canvas.drawOval(CK.LTRBRect(-0.6, -0.68, -0.34, -0.56), K.fill("#ffffff", 0.55 * g));
    canvas.restore();
    canvas.drawCircle(-0.66, -0.4, 0.05, K.fill("#ffffff", 0.5 * g));
  }
}

/** Kawaii faces. Fruits: open eyes with glints and a smile; cosmos: closed eyes + blush. */
export function drawFace(CK, canvas, piece, closed) {
  const K = makePaints(CK);
  const P = pathKit(CK);
  const f = piece.face ?? {};
  const fx = f.x ?? 0, fy = f.y ?? 0.05, s = (f.s ?? 1) * 1.15;
  const ink = f.ink ?? "#3a1418";
  const ex = 0.36 * s, er = 0.13 * s;
  if (!closed) {
    canvas.drawOval(CK.LTRBRect(fx - ex - 0.14 * s, fy + 0.07 * s, fx - ex + 0.1 * s, fy + 0.18 * s), K.fill(f.blush ?? "#ff3b6b", 0.18));
    canvas.drawOval(CK.LTRBRect(fx + ex - 0.1 * s, fy + 0.07 * s, fx + ex + 0.14 * s, fy + 0.18 * s), K.fill(f.blush ?? "#ff3b6b", 0.18));
    for (const sx of [-1, 1]) {
      const x = fx + sx * ex, y = fy - 0.1 * s;
      canvas.drawCircle(x, y, er, K.fill(ink));
      canvas.drawCircle(x - er * 0.3, y - er * 0.36, er * 0.27, K.fill("#ffffff"));
      canvas.drawCircle(x + er * 0.36, y + er * 0.36, er * 0.13, K.fill("#ffffff", 0.75));
    }
    canvas.drawPath(P((b) => b.M(fx - 0.13 * s, fy + 0.04 * s).Q(fx, fy + 0.17 * s, fx + 0.13 * s, fy + 0.04 * s)), K.stroke(ink, 0.045 * s));
  } else {
    for (const sx of [-1, 1]) {
      const x = fx + sx * ex, y = fy - 0.07 * s;
      canvas.drawOval(CK.LTRBRect(x - 0.15 * s + sx * 0.05 * s, y + 0.09 * s, x + 0.15 * s + sx * 0.05 * s, y + 0.21 * s), K.fill(f.blush ?? "#ff6f91", 0.45));
      canvas.drawPath(P((b) => b.M(x - 0.1 * s, y).Q(x, y + 0.1 * s, x + 0.1 * s, y)), K.stroke(ink, 0.05 * s));
    }
    canvas.drawPath(P((b) => b.M(fx - 0.07 * s, fy + 0.08 * s).Q(fx, fy + 0.15 * s, fx + 0.07 * s, fy + 0.08 * s)), K.stroke(ink, 0.04 * s));
  }
}

/**
 * Draw one piece: centre (x,y), collider radius R (px), rotation `rot` (radians).
 * Order: back overhangs -> clipped body + features -> unrotated light -> face -> front overhangs.
 */
export function drawPiece(CK, canvas, piece, styleName, x, y, R, rot = 0, opts = {}) {
  const pen = makePen(CK, canvas, styleName);
  const deg = (rot * 180) / Math.PI;
  canvas.save();
  canvas.translate(x, y);
  canvas.scale(R, R);
  canvas.save();
  canvas.rotate(deg, 0, 0);
  piece.back?.(pen);
  canvas.restore();
  canvas.save();
  canvas.clipPath(pen.P((b) => b.circ(0, 0, 1)), CK.ClipOp.Intersect, true);
  canvas.save();
  canvas.rotate(deg, 0, 0);
  piece.body(pen);
  canvas.restore();
  if (!piece.noLight) drawLight(CK, canvas, styleName, piece);
  if (styleName === "kawaii" && opts.face !== false && piece.face !== null) {
    canvas.save();
    canvas.rotate(deg, 0, 0);
    drawFace(CK, canvas, piece, piece.set === "cosmos");
    canvas.restore();
  }
  canvas.restore();
  canvas.save();
  canvas.rotate(deg, 0, 0);
  piece.front?.(pen);
  canvas.restore();
  canvas.restore();
}
