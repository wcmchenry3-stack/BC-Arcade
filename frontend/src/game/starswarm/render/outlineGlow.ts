/**
 * #3592: the armour outline on the web canvas (secondary platform).
 *
 * Native draws the outline with a Skia image filter every frame. A 2D canvas has no dilate, so the
 * same glow is built once per gun and hull level into a small offscreen canvas and then drawn
 * under the ship's layers with one `drawImage`. Building touches the canvas API a few dozen times
 * and happens the first time a combination is on screen; steady-state frames allocate nothing.
 *
 * How the glow is made, at the sprites' own resolution (3x the game px):
 *   1. draw the ship's layers into one canvas (the composed silhouette);
 *   2. dilate it by `grow`: draw that canvas again at `STEPS` offsets on a circle (and the middle);
 *   3. tint it armour blue (`source-in`);
 *   4. blur it with `shadowBlur`, drawing the tinted shape off the canvas and its shadow onto it
 *      (`shadowBlur` is 2 sigma; `ctx.filter` is not in every browser, shadows are).
 */
import { cssRgba } from "./color";
import { ARMOR_BLUE_RGB } from "./palette";
import { ARMOUR_OUTLINE } from "./ship";
import type { ArmourLevel, ShipSpriteKey } from "./ship";

/** Offsets round the dilation circle. */
const STEPS = 24;

export type GlowSource = CanvasImageSource & { readonly width: number; readonly height: number };

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
 * The outline glow for `layers` (decoded images, bottom to top, all the same size), at `level`,
 * or null when a 2D context is not available. `scale` is the image px per game px (3).
 */
export function buildOutlineGlow(
  layers: readonly GlowSource[],
  level: ArmourLevel,
  scale: number,
  makeCanvas: MakeCanvas = defaultMakeCanvas
): HTMLCanvasElement | null {
  const first = layers[0];
  if (!first) return null;
  const w = first.width;
  const h = first.height;
  const sil = makeCanvas(w, h);
  const dil = makeCanvas(w, h);
  const out = makeCanvas(w, h);
  const sctx = sil?.getContext("2d");
  const dctx = dil?.getContext("2d");
  const octx = out?.getContext("2d");
  if (!sil || !dil || !out || !sctx || !dctx || !octx) return null;

  const o = ARMOUR_OUTLINE[level];
  for (const l of layers) sctx.drawImage(l, 0, 0);

  const r = o.grow * scale;
  dctx.drawImage(sil, 0, 0);
  for (let i = 0; i < STEPS; i++) {
    const a = (i * 2 * Math.PI) / STEPS;
    dctx.drawImage(sil, Math.cos(a) * r, Math.sin(a) * r);
  }
  dctx.globalCompositeOperation = "source-in";
  dctx.fillStyle = cssRgba(ARMOR_BLUE_RGB, 1);
  dctx.fillRect(0, 0, w, h);

  // The shape is drawn `w` px left of the canvas; its shadow, offset by `w`, lands on it.
  octx.shadowColor = cssRgba(ARMOR_BLUE_RGB, o.alpha);
  octx.shadowBlur = 2 * o.sigma * scale;
  octx.shadowOffsetX = w;
  octx.shadowOffsetY = 0;
  octx.drawImage(dil, -w, 0);
  return out;
}

/** Built glows by `(guns - 1) * 3 + hull`: undefined until first needed, null if it cannot be made. */
export type GlowCache = (HTMLCanvasElement | null | undefined)[];

/**
 * The cached glow for a gun and hull level, built from the stack's images the first time it is
 * asked for. Returns null (and caches nothing) while a layer of the stack has not loaded.
 */
export function shipGlow(
  cache: GlowCache,
  stack: readonly ShipSpriteKey[],
  images: Readonly<Record<ShipSpriteKey, GlowSource | null>>,
  guns: number,
  hull: number,
  level: ArmourLevel,
  scale: number,
  makeCanvas?: MakeCanvas
): HTMLCanvasElement | null {
  const i = (Math.min(3, Math.max(1, guns)) - 1) * 3 + hull;
  const hit = cache[i];
  if (hit !== undefined) return hit;
  const layers: GlowSource[] = [];
  for (const k of stack) {
    const img = images[k];
    if (!img) return null;
    layers.push(img);
  }
  const glow = buildOutlineGlow(layers, level, scale, makeCanvas);
  cache[i] = glow;
  return glow;
}
