/**
 * #3596: the asteroid tint, shared by both renderers.
 *
 * The rock art ships neutral (greyscale): one file per shape, not one per palette. Each rock is
 * tinted at runtime into one of `ROCK_PALETTES` by the same per-channel affine map of its grey
 * value `L` (0..1): `colour = edge + L * (light - edge)`, alpha untouched.
 *
 * - Native (Skia): `rockTintMatrix` is the 4x5 colour matrix of that map; `drawFrame.ts` makes
 *   one paint per palette with it on first use and keeps it in its draw cache, so a frame only
 *   draws images with a cached paint.
 * - Web (2D canvas, secondary platform): a canvas has no colour matrix, so `buildTintedRock`
 *   bakes each shape x palette once into a small offscreen canvas with compositing alone (no
 *   pixel read-back, so it cannot trip on a tainted canvas), and the frame draws those.
 *
 * The ore veins of a large rock are a separate image drawn over the body untinted, so the
 * salvage glow stays gold on every palette.
 */
import { hashFrac } from "../engine";
import { cssHex } from "./color";
import type { DrawOp } from "./frame";
import { ROCK_PALETTES } from "./palette";
import { drawShapeOp } from "./pickups";

/** How many palettes a rock can be tinted into. */
export const ROCK_PALETTE_COUNT = ROCK_PALETTES.length;

/**
 * Which palette a rock is tinted into (an index into `ROCK_PALETTES`), stable for its life: a
 * hash of its id. The rock's art and, through the explosion's `srcId`, its dust when it breaks
 * both use this one function, so the dust always matches the rock.
 */
export function rockPalette(id: number): number {
  return Math.floor(hashFrac(id * 39.346 + 7.5) * ROCK_PALETTE_COUNT) % ROCK_PALETTE_COUNT;
}

const channels = (rgb: number): [number, number, number] => [
  (rgb >> 16) & 0xff,
  (rgb >> 8) & 0xff,
  rgb & 0xff,
];

/**
 * The tint of palette `i` as a Skia colour matrix (row-major 4x5 on unpremultiplied 0..1
 * colour, offsets in 0..1): each channel is scaled by `light - edge` and offset by `edge`.
 */
export function rockTintMatrix(i: number): number[] {
  const p = ROCK_PALETTES[i] ?? ROCK_PALETTES[0]!;
  const [lr, lg, lb] = channels(p.light);
  const [er, eg, eb] = channels(p.edge);
  // prettier-ignore
  return [
    (lr - er) / 255, 0, 0, 0, er / 255,
    0, (lg - eg) / 255, 0, 0, eg / 255,
    0, 0, (lb - eb) / 255, 0, eb / 255,
    0, 0, 0, 1, 0,
  ];
}

/** Built once per JS runtime: every palette's matrix (the native worklet reads these). */
export const ROCK_TINT_MATRICES: readonly (readonly number[])[] = ROCK_PALETTES.map((_, i) =>
  rockTintMatrix(i)
);

/** `light - edge` and `edge` of palette `i` as CSS colours, for the web bake. */
function webTint(i: number): { scale: string; offset: string } {
  const p = ROCK_PALETTES[i] ?? ROCK_PALETTES[0]!;
  const [lr, lg, lb] = channels(p.light);
  const [er, eg, eb] = channels(p.edge);
  return {
    scale: cssHex(((lr - er) << 16) | ((lg - eg) << 8) | (lb - eb)),
    offset: cssHex(p.edge),
  };
}

export type RockTintSource = CanvasImageSource & {
  readonly width: number;
  readonly height: number;
};

/** Makes an offscreen canvas; overridden in tests. */
export type MakeCanvas = (w: number, h: number) => HTMLCanvasElement | null;

const defaultMakeCanvas: MakeCanvas = (w, h) => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/**
 * Web: the neutral rock `img` baked into palette `i`, or null when a 2D context is not
 * available. On an opaque black backdrop the grey image is multiplied by `light - edge`, the
 * `edge` colour is added (`lighter`), and the rock's own alpha is put back (`destination-in`):
 * `edge + L * (light - edge)`, the native matrix. At a soft edge pixel (alpha a) the colour comes
 * out as `edge + a * L * (light - edge)`, a touch darker than native's; those pixels sit on the
 * art's dark edge stroke (L near 0), so the difference does not show.
 */
export function buildTintedRock(
  img: RockTintSource,
  i: number,
  makeCanvas: MakeCanvas = defaultMakeCanvas
): HTMLCanvasElement | null {
  const w = img.width;
  const h = img.height;
  if (!(w > 0 && h > 0)) return null;
  const out = makeCanvas(w, h);
  const ctx = out?.getContext("2d");
  if (!out || !ctx) return null;
  const t = webTint(i);
  ctx.fillStyle = cssHex(0); // opaque black
  ctx.fillRect(0, 0, w, h);
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = t.scale;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "lighter";
  ctx.fillStyle = t.offset;
  ctx.fillRect(0, 0, w, h);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0, w, h);
  ctx.globalCompositeOperation = "source-over";
  return out;
}

/** Web: baked rocks by `rockTintSlot`: undefined until built, null if one cannot be made. */
export type RockTintCache = (HTMLCanvasElement | null | undefined)[];

/** The cache slot of body number `body` (its index in the caller's body list) in palette `i`. */
export function rockTintSlot(body: number, i: number): number {
  return body * ROCK_PALETTE_COUNT + i;
}

/** Web: whether body number `body` has been baked into every palette. */
export function rockBodyBaked(cache: RockTintCache, body: number): boolean {
  for (let i = 0; i < ROCK_PALETTE_COUNT; i++) if (!cache[rockTintSlot(body, i)]) return false;
  return true;
}

/**
 * Web: bakes every body in `bodies` into every palette, once, right after the images load, so no
 * frame builds one. A body that has not loaded is skipped (and baked by a later call); one that
 * cannot be baked is cached as null, not retried.
 */
export function prebuildRockTints(
  cache: RockTintCache,
  bodies: readonly (RockTintSource | null)[],
  makeCanvas?: MakeCanvas
): void {
  bodies.forEach((img, b) => {
    if (!img) return;
    for (let i = 0; i < ROCK_PALETTE_COUNT; i++) {
      const slot = rockTintSlot(b, i);
      if (cache[slot] === undefined) cache[slot] = buildTintedRock(img, i, makeCanvas);
    }
  });
}

/**
 * Web: replay `asteroidOps` on a 2D context. An image op is drawn about its centre at its
 * rotation, from the baked canvas when it carries a `tint` (looked up by `bodySlot`, the body's
 * index), else from `images` (the untinted veins); every other op as a shape. Nothing is built
 * here: a bake that is missing is skipped.
 */
export function drawRockOps(
  ctx: CanvasRenderingContext2D,
  ops: readonly DrawOp[],
  images: Readonly<Record<string, CanvasImageSource | null>>,
  tints: RockTintCache,
  bodySlot: (sprite: string) => number
): void {
  for (const op of ops) {
    if (op.k !== "image") {
      drawShapeOp(ctx, op);
      continue;
    }
    const src =
      op.tint !== undefined ? tints[rockTintSlot(bodySlot(op.sprite), op.tint)] : images[op.sprite];
    if (!src) continue;
    const cx = op.x + op.w / 2;
    const cy = op.y + op.h / 2;
    ctx.save();
    ctx.translate(cx, cy);
    if (op.rotate) ctx.rotate(op.rotate);
    ctx.drawImage(src, -op.w / 2, -op.h / 2, op.w, op.h);
    ctx.restore();
  }
  ctx.lineWidth = 1;
}
