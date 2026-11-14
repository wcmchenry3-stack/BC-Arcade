/**
 * #3698: the Dragonfruit (Fruits tier 8), take B of the three redraws of the original art, the
 * owner's pick (2026-11-14): "simplified for game size". A round magenta body that is the
 * collider circle; flame-shaped bracts with a pink-to-green base, a lighter green centre and a
 * darker green outline that fades into the skin; three crown bracts on top as the one big
 * overhang (0.45 r), and two side bracts a side peeking out behind the body (at most 0.10 r).
 */
import { CASCADE_ART } from "../../../theme/theme.cascade";
import { P, asStroke, linear, mix, rgba, type Pen, type PieceArt } from "./pen";

const T = CASCADE_ART.fruits;

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

export const DRAGONFRUIT: PieceArt = {
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
  box: [-1.15, -1.5, 1.15, 1],
};
