/**
 * #3597: the background's N2 "teal-violet" nebula (owner-approved), as shared geometry: a soft
 * violet cloud high on the right and a teal one low on the left, each a few overlapping radial
 * gradients that fade to nothing, at low alpha over the space black.
 *
 * It is baked once with the background and never drawn per frame: native records it into the
 * backdrop Picture (`starfieldPictures.ts`), web paints it into an offscreen canvas it blits as
 * its background (`GameCanvas.web.tsx`). It does not scroll — only the stars do, which keeps it
 * free and makes the stars read as nearer than the clouds.
 *
 * Positions and radii are fractions of the canvas (radii of its width), so any size gets the
 * same picture.
 */
import { cssRgba } from "./color";
import { NEBULA_TEAL_RGB, NEBULA_VIOLET_RGB } from "./palette";

/** One soft blob: a radial gradient from `rgb` at `alpha` in the centre to transparent at `r`. */
export interface NebulaBlob {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
  /** 0xRRGGBB. */
  readonly rgb: number;
  readonly alpha: number;
}

/** In canvas fractions: x and y of width and height, r of width. Back to front. */
const BLOBS: readonly NebulaBlob[] = [
  // The violet cloud, top right: a broad body and two denser lobes
  { cx: 0.78, cy: 0.28, r: 0.62, rgb: NEBULA_VIOLET_RGB, alpha: 0.22 },
  { cx: 0.86, cy: 0.2, r: 0.32, rgb: NEBULA_VIOLET_RGB, alpha: 0.2 },
  { cx: 0.62, cy: 0.36, r: 0.26, rgb: NEBULA_VIOLET_RGB, alpha: 0.14 },
  // The teal cloud, lower left
  { cx: 0.22, cy: 0.78, r: 0.55, rgb: NEBULA_TEAL_RGB, alpha: 0.26 },
  { cx: 0.12, cy: 0.72, r: 0.28, rgb: NEBULA_TEAL_RGB, alpha: 0.22 },
  { cx: 0.34, cy: 0.88, r: 0.24, rgb: NEBULA_TEAL_RGB, alpha: 0.16 },
];

/** The nebula's blobs for a `width` x `height` canvas, in px, back to front. */
export function nebulaBlobs(width: number, height: number): NebulaBlob[] {
  return BLOBS.map((b) => ({ ...b, cx: b.cx * width, cy: b.cy * height, r: b.r * width }));
}

/** Makes a blank canvas of the given size, or null where there is no DOM. */
export type MakeCanvas = (w: number, h: number) => HTMLCanvasElement | null;

const defaultMakeCanvas: MakeCanvas = (w, h) => {
  if (typeof document === "undefined") return null;
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
};

/**
 * Web (2D canvas): the background fill and the nebula, painted once into an offscreen canvas the
 * frame blits as its background (one `drawImage` a frame, no gradients rebuilt). `scale` is the
 * device px per game px, so the clouds stay smooth on a high-density screen. Null when no 2D
 * context is available; the caller then fills the plain background.
 */
export function buildWebBackdrop(
  width: number,
  height: number,
  scale: number,
  bgCss: string,
  makeCanvas: MakeCanvas = defaultMakeCanvas
): HTMLCanvasElement | null {
  // Rounded up so the backdrop covers the whole canvas; at a fractional scale the blit resamples
  // it by under a device pixel, which is invisible on soft gradients
  const w = Math.max(1, Math.ceil(width * scale));
  const h = Math.max(1, Math.ceil(height * scale));
  const canvas = makeCanvas(w, h);
  const ctx = canvas?.getContext("2d");
  if (!canvas || !ctx || typeof ctx.createRadialGradient !== "function") return null;
  ctx.scale(scale, scale);
  ctx.fillStyle = bgCss;
  ctx.fillRect(0, 0, width, height);
  for (const b of nebulaBlobs(width, height)) {
    const g = ctx.createRadialGradient(b.cx, b.cy, 0, b.cx, b.cy, b.r);
    g.addColorStop(0, cssRgba(b.rgb, b.alpha));
    g.addColorStop(1, cssRgba(b.rgb, 0));
    ctx.fillStyle = g;
    ctx.fillRect(b.cx - b.r, b.cy - b.r, b.r * 2, b.r * 2);
  }
  return canvas;
}
