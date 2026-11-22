/**
 * #3698: the bin, drawn exactly at the physics geometry (owner pick: the "soft outline").
 *
 * The board is the card: a thick rounded U band tinted in the theme accent, a solid accent rail on
 * the band's inner face, a faint accent wash rising from the floor, and the card's border
 * hairline. The inner faces sit at x = `WALL_THICKNESS` and `WORLD_WIDTH - WALL_THICKNESS` and the
 * floor top at `WORLD_HEIGHT - FLOOR_THICKNESS`, so a piece resting on the physics floor rests on
 * the drawn one. The inner bottom corners have radius `INNER_RADIUS`, no more than the smallest
 * piece's radius, so no piece can sit in the curve. The rail is clipped to outside the cavity, so
 * no piece ever overlaps it.
 *
 * One static `SkPicture` in world units per theme (the same for both sets), recorded once and
 * drawn before the pieces. No blur, no per-frame work. Runs on the JS thread; the board passes
 * the Picture to Skia as a prop.
 */
import {
  ClipOp,
  PaintStyle,
  PathOp,
  Skia,
  StrokeCap,
  StrokeJoin,
  TileMode,
} from "@shopify/react-native-skia";
import type { SkPaint, SkPath, SkPicture } from "@shopify/react-native-skia";
import { CASCADE_BIN_PALETTE } from "../../../theme/theme.cascade";
import { FLOOR_THICKNESS, WALL_THICKNESS, WORLD_HEIGHT, WORLD_WIDTH } from "../constants";
import { rgba } from "./pen";

/** The cavity's inner faces and floor top, in world units (= the physics). */
export const BIN_INNER_LEFT = WALL_THICKNESS;
export const BIN_INNER_RIGHT = WORLD_WIDTH - WALL_THICKNESS;
export const BIN_FLOOR_TOP = WORLD_HEIGHT - FLOOR_THICKNESS;
/** Inner bottom corner radius (<= the smallest piece radius, `tierRadius(0)`: 5 since #3904). */
export const BIN_INNER_RADIUS = 5;
/** The card's outer corners: small at the top, large at the bottom. */
const OUTER_TOP_RADIUS = 10;
const OUTER_BOTTOM_RADIUS = 36;
/** The rail's stroke width and how far down the wash rises from the floor. */
const RAIL_WIDTH = 6;
const WASH_HEIGHT = 220;
/** The inset that keeps the outer hairline inside the board. */
const HAIRLINE = 1.5;

function fillPaint(hex: string, a = 1): SkPaint {
  const p = Skia.Paint();
  p.setAntiAlias(true);
  p.setColor(rgba(hex, a));
  return p;
}

function roundRectPath(x: number, y: number, w: number, h: number, rt: number, rb: number): SkPath {
  const p = Skia.PathBuilder.Make();
  p.moveTo(x + rt, y);
  p.lineTo(x + w - rt, y);
  p.quadTo(x + w, y, x + w, y + rt);
  p.lineTo(x + w, y + h - rb);
  p.arcToTangent(x + w, y + h, x + w - rb, y + h, rb);
  p.lineTo(x + rb, y + h);
  p.arcToTangent(x, y + h, x, y + h - rb, rb);
  p.lineTo(x, y + rt);
  p.quadTo(x, y, x + rt, y);
  p.close();
  return p.build();
}

/** The cavity, open at the top, from y = `top` down to the floor. */
function cavityPath(top: number): SkPath {
  const L = BIN_INNER_LEFT;
  const R = BIN_INNER_RIGHT;
  const F = BIN_FLOOR_TOP;
  const k = BIN_INNER_RADIUS;
  const p = Skia.PathBuilder.Make();
  p.moveTo(L, top);
  p.lineTo(L, F - k);
  p.arcToTangent(L, F, L + k, F, k);
  p.lineTo(R - k, F);
  p.arcToTangent(R, F, R, F - k, k);
  p.lineTo(R, top);
  p.close();
  return p.build();
}

/** The inner-face line of the U (open), wall top to wall top. */
function innerU(top: number): SkPath {
  const L = BIN_INNER_LEFT;
  const R = BIN_INNER_RIGHT;
  const F = BIN_FLOOR_TOP;
  const k = BIN_INNER_RADIUS;
  const p = Skia.PathBuilder.Make();
  p.moveTo(L, top);
  p.lineTo(L, F - k);
  p.arcToTangent(L, F, L + k, F, k);
  p.lineTo(R - k, F);
  p.arcToTangent(R, F, R, F - k, k);
  p.lineTo(R, top);
  return p.build();
}

/** Records the bin of `theme` as a Picture in world units. Null if Skia cannot. */
function recordBin(theme: "light" | "dark"): SkPicture | null {
  try {
    const c = CASCADE_BIN_PALETTE[theme];
    const dark = theme === "dark";
    const outer = roundRectPath(
      0,
      0,
      WORLD_WIDTH,
      WORLD_HEIGHT,
      OUTER_TOP_RADIUS,
      OUTER_BOTTOM_RADIUS
    );
    const shell = Skia.Path.MakeFromOp(outer, cavityPath(-1), PathOp.Difference) ?? outer;
    const recorder = Skia.PictureRecorder();
    const cv = recorder.beginRecording(Skia.XYWHRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT));

    cv.drawPath(outer, fillPaint(c.surface));

    // A faint wash rising from the floor.
    const wash = Skia.Paint();
    wash.setAntiAlias(true);
    wash.setShader(
      Skia.Shader.MakeLinearGradient(
        { x: 0, y: BIN_FLOOR_TOP - WASH_HEIGHT },
        { x: 0, y: BIN_FLOOR_TOP },
        [rgba(c.accent, 0), rgba(c.accent, dark ? 0.07 : 0.12)],
        null,
        TileMode.Clamp
      )
    );
    cv.drawPath(cavityPath(0), wash);

    // The band: walls and floor, the accent tinted over the surface.
    cv.drawPath(shell, fillPaint(c.accent, dark ? 0.22 : 0.3));

    // The solid rail on the inner face, clipped to the band so it never enters the cavity.
    const rail = fillPaint(c.accent);
    rail.setStyle(PaintStyle.Stroke);
    rail.setStrokeWidth(RAIL_WIDTH);
    rail.setStrokeCap(StrokeCap.Round);
    rail.setStrokeJoin(StrokeJoin.Round);
    cv.save();
    cv.clipPath(shell, ClipOp.Intersect, true);
    cv.drawPath(innerU(4), rail);
    cv.restore();

    // The card's hairline, inset so it is whole inside the board.
    const hair = fillPaint(c.border);
    hair.setStyle(PaintStyle.Stroke);
    hair.setStrokeWidth(HAIRLINE);
    cv.drawPath(
      roundRectPath(
        HAIRLINE / 2,
        HAIRLINE / 2,
        WORLD_WIDTH - HAIRLINE,
        WORLD_HEIGHT - HAIRLINE,
        OUTER_TOP_RADIUS,
        OUTER_BOTTOM_RADIUS
      ),
      hair
    );
    return recorder.finishRecordingAsPicture();
  } catch {
    return null;
  }
}

const binCache = new Map<string, SkPicture | null>();

/** The bin Picture for `theme`, recorded once (memoized). Null if it cannot be recorded. */
export function binPicture(theme: "light" | "dark"): SkPicture | null {
  if (binCache.has(theme)) return binCache.get(theme) ?? null;
  const picture = recordBin(theme);
  binCache.set(theme, picture);
  return picture;
}

/** @internal Test seam: forget the recorded bins (without disposing). */
export function __resetBinCacheForTests(): void {
  binCache.clear();
}
