/**
 * #3698: where the code-drawn pieces (`pen.ts`, `fruits.ts`, `cosmos.ts`) become something the
 * screens draw, with two caches:
 *
 * - **Board sprites** (`pieceSprites`): each tier's three layers (`body`, `light`, `top`; see
 *   `pen.ts`) rasterised once into CPU bitmaps at the size the board shows them, so the
 *   UI-thread renderer (`render/drawFrame.ts`) draws each piece as three `drawImageRect`s, the
 *   body and top rotated with the physics and the light upright. The bitmap's scale is
 *   `pxPerUnit` = board scale x device pixel ratio: one bitmap pixel per screen pixel at the
 *   tier's drawn radius (#3904: 1.5 % inside the ladder radius, `tierDrawnRadius`), so a piece is
 *   never drawn from a bitmap scaled up (only down, for the
 *   grow-in and the spawner's smaller copy). The key is the set and `pxPerUnit`; the
 *   last `MAX_SPRITE_SETS` keys are kept and an evicted key's bitmaps are disposed. `pxPerUnit`
 *   is rounded up to `PX_STEP` first, so a resize by a pixel or two reuses the set instead of
 *   churning through new ones. The board (`CascadeBoard`) is the only holder of a set: its
 *   UI-thread closure keeps the sprites it was given alive, and a set it still draws is always
 *   the most recently requested key, which is never the one evicted.
 * - **Icon pictures** (`piecePicture`): a whole piece, upright, recorded as an `SkPicture` (vector)
 *   fitted into a `size` x `size` box, for the next-piece preview, the dev panel, the theme
 *   selector and the home tile. A Picture replays its paths at whatever pixel ratio the canvas
 *   has, so it is never blurry; the key is set, tier and size.
 *
 * Everything here runs on the JS thread. A layer that fails to rasterise (no Skia, a surface that
 * could not be made) leaves that tier `null`, and the board draws its placeholder circle.
 */
import { Skia } from "@shopify/react-native-skia";
import type { SkImage, SkPicture } from "@shopify/react-native-skia";
import { TIER_COUNT, tierDrawnRadius, type TierSetId } from "../tiers";
import { COSMOS_ART } from "./cosmos";
import { FRUIT_ART } from "./fruits";
import { UNIT_BOX, drawLayer, drawPiece, type ArtSet, type Layer } from "./pen";

export const ART_SETS: Readonly<Record<TierSetId, ArtSet>> = {
  fruits: FRUIT_ART,
  cosmos: COSMOS_ART,
};

/** The art for a fruit-set id (an unknown id draws Fruits, as `FRUIT_SETS` falls back). */
export function artSet(setId: string): ArtSet {
  return ART_SETS[setId as TierSetId] ?? FRUIT_ART;
}

/** x, y, width, height around the piece's centre, in world units at the tier's full radius. */
export type SpriteRect = readonly [number, number, number, number];

/** One tier's bitmaps and where they land. */
export interface PieceSprite {
  /** Back overhangs and the clipped body: rotates with the piece. */
  readonly body: SkImage;
  /** The light, upright. */
  readonly light: SkImage;
  /** The face and the front overhangs: rotates with the piece. */
  readonly top: SkImage;
  /** Where `body` and `top` land (the piece's `box` at its radius). */
  readonly rect: SpriteRect;
  /** Where `light` lands (the collider's square). */
  readonly lightRect: SpriteRect;
}

/** Per tier; null where a tier could not be drawn (placeholder circle). */
export type PieceSprites = readonly (PieceSprite | null)[];

/** Sprite sets (set x pixel scale) kept before the least recently used is disposed. */
export const MAX_SPRITE_SETS = 3;

/** `pxPerUnit` is rounded up to this step (never down: bitmaps stay at least screen sharp). */
export const PX_STEP = 0.05;

/** `px` rounded up to `PX_STEP`; the scale the bitmaps are drawn at and the cache keys on. */
export function quantizePx(px: number): number {
  return Math.round(Math.ceil(px / PX_STEP - 1e-9) * PX_STEP * 1e6) / 1e6;
}

/** A bitmap of one layer and the world rect it covers. */
function rasterise(
  set: ArtSet,
  tier: number,
  layer: Layer,
  box: readonly [number, number, number, number],
  r: number,
  px: number
): { image: SkImage; rect: SpriteRect } | null {
  const x0 = box[0] * r;
  const y0 = box[1] * r;
  const w = Math.ceil((box[2] - box[0]) * r * px);
  const h = Math.ceil((box[3] - box[1]) * r * px);
  // A CPU raster surface: its snapshot is a plain bitmap the UI thread can draw (as Mahjong's).
  const surface = Skia.Surface.Make(w, h);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.scale(px, px);
    canvas.translate(-x0, -y0);
    canvas.scale(r, r);
    drawLayer(canvas, set, tier, layer);
    surface.flush();
    return { image: surface.makeImageSnapshot(), rect: [x0, y0, w / px, h / px] };
  } finally {
    surface.dispose();
  }
}

function drawTier(set: ArtSet, tier: number, px: number): PieceSprite | null {
  const art = set.pieces[tier];
  const r = tierDrawnRadius(tier);
  if (!art || r <= 0 || !(px > 0)) return null;
  const made: SkImage[] = [];
  try {
    // Bail on the first layer that fails: no point rasterising the rest.
    const body = rasterise(set, tier, "body", art.box, r, px);
    if (!body) return null;
    made.push(body.image);
    const light = rasterise(set, tier, "light", UNIT_BOX, r, px);
    if (!light) throw new Error("surface");
    made.push(light.image);
    const top = rasterise(set, tier, "top", art.box, r, px);
    if (!top) throw new Error("surface");
    made.push(top.image);
    return {
      body: body.image,
      light: light.image,
      top: top.image,
      rect: body.rect,
      lightRect: light.rect,
    };
  } catch {
    for (const image of made) image.dispose();
    return null;
  }
}

/** Rasterised sets per key, least recently used first. */
const spriteCache = new Map<string, PieceSprites>();

/**
 * The board sprites of `setId` at `pxPerUnit` bitmap pixels per world unit, drawn on the first
 * call for that key and cached after it (as the most recently used).
 */
export function pieceSprites(setId: string, pxPerUnit: number): PieceSprites {
  const px = quantizePx(pxPerUnit);
  const key = `${setId}@${px}`;
  const hit = spriteCache.get(key);
  if (hit) {
    spriteCache.delete(key);
    spriteCache.set(key, hit);
    return hit;
  }
  const set = artSet(setId);
  const sprites = Array.from({ length: TIER_COUNT }, (_, tier) => drawTier(set, tier, px));
  spriteCache.set(key, sprites);
  for (const [k, old] of spriteCache) {
    if (spriteCache.size <= MAX_SPRITE_SETS) break;
    spriteCache.delete(k);
    for (const s of old) {
      s?.body.dispose();
      s?.light.dispose();
      s?.top.dispose();
    }
  }
  return sprites;
}

function clearPictures(): void {
  for (const p of pictureCache.values()) p?.dispose();
  pictureCache.clear();
}

/** Icon pictures per set|tier|size. Few sizes exist (preview, panel, selector, home). */
const pictureCache = new Map<string, SkPicture | null>();
const MAX_PICTURES = 96;

/**
 * Tier `tier` of `setId`, upright with its overhangs, fitted and centred in a `size` x `size`
 * box (points). Null if it cannot be recorded.
 */
export function piecePicture(setId: string, tier: number, size: number): SkPicture | null {
  const key = `${setId}|${tier}|${size}`;
  if (pictureCache.has(key)) return pictureCache.get(key) ?? null;
  const set = artSet(setId);
  const art = set.pieces[tier];
  let picture: SkPicture | null = null;
  if (art && size > 0) {
    try {
      const [l, t, r, b] = art.box;
      const k = size / Math.max(r - l, b - t);
      const recorder = Skia.PictureRecorder();
      const canvas = recorder.beginRecording(Skia.XYWHRect(0, 0, size, size));
      canvas.translate(size / 2 - ((l + r) / 2) * k, size / 2 - ((t + b) / 2) * k);
      canvas.scale(k, k);
      drawPiece(canvas, set, tier);
      picture = recorder.finishRecordingAsPicture();
    } catch {
      picture = null;
    }
  }
  if (pictureCache.size >= MAX_PICTURES) clearPictures();
  pictureCache.set(key, picture);
  return picture;
}

/** @internal Test seam: forget every cached sprite set and picture (without disposing). */
export function __resetArtCachesForTests(): void {
  spriteCache.clear();
  pictureCache.clear();
}
