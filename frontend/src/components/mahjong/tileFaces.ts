/**
 * Mahjong tile face art for the native canvas (#2962): the 42 SVG faces are decoded once per
 * app session and rasterised once per face size into `SkImage`s, so the board draws each tile
 * face as a bitmap (`<Image>`) instead of re-rendering its SVG (`<ImageSVG>`) on every frame.
 *
 * - Decoding: `loadTileSVGs` reads and parses every face once (module-level promise); a later
 *   mount (the canvas unmounts whenever the screen leaves "play") gets the parsed set at once.
 * - Rasterising: `tileFacesFor` draws each face into an offscreen surface at the art box's size
 *   times the device pixel ratio, and keeps the result per size (`faceWidth`x`faceHeight`), so
 *   a size is rasterised once however often the canvas mounts or re-renders. The last
 *   `MAX_CACHED_SIZES` sizes are kept (a rotation or a new layout changes the size).
 *
 * A face that fails to load or rasterise is null; the canvas draws its suit-colour fallback.
 */
import { useEffect, useMemo, useState } from "react";
import { PixelRatio } from "react-native";
import { loadData, Skia } from "@shopify/react-native-skia";
import type { SkImage, SkSVG } from "@shopify/react-native-skia";
import { TILE_REQUIRES } from "./tileAssets";

/** Index `faceId - 1`: one entry per face asset, null where it didn't load. */
export type TileFaces = ReadonlyArray<SkImage | null>;
type TileSVGs = ReadonlyArray<SkSVG | null>;

/** The face art sits this far inside the tile face on every side. */
export const ART_INSET = 2;

/** Face sizes kept rasterised at once. */
const MAX_CACHED_SIZES = 4;

let decoded: TileSVGs | null = null;
let decoding: Promise<TileSVGs> | null = null;
const rasterised = new Map<string, TileFaces>();

function decode(source: number): Promise<SkSVG | null> {
  try {
    return loadData(source, (data) => Skia.SVG.MakeFromData(data)).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/** Every face's parsed SVG, read and parsed at most once per app session. */
export function loadTileSVGs(): Promise<TileSVGs> {
  if (!decoding) {
    decoding = Promise.all(TILE_REQUIRES.map(decode)).then((all) => {
      decoded = all;
      return all;
    });
  }
  return decoding;
}

/** `svg` drawn into a w x h box, as a bitmap of `scale` pixels per point. */
function rasterise(svg: SkSVG, w: number, h: number, scale: number): SkImage | null {
  const pw = Math.ceil(w * scale);
  const ph = Math.ceil(h * scale);
  const surface = Skia.Surface.MakeOffscreen(pw, ph) ?? Skia.Surface.Make(pw, ph);
  if (!surface) return null;
  surface.getCanvas().scale(pw / w, ph / h);
  surface.getCanvas().drawSvg(svg, w, h);
  surface.flush();
  const snapshot = surface.makeImageSnapshot();
  // A GPU snapshot belongs to the offscreen context; a raster copy draws in any canvas.
  const raster = snapshot.makeNonTextureImage();
  if (!raster) return snapshot;
  surface.dispose();
  return raster;
}

/**
 * The faces for tiles of `faceWidth` x `faceHeight`, rasterised on the first call for that
 * size (and pixel ratio) and cached after it.
 */
export function tileFacesFor(
  svgs: TileSVGs,
  faceWidth: number,
  faceHeight: number,
  scale: number = PixelRatio.get()
): TileFaces {
  const key = `${faceWidth}x${faceHeight}@${scale}`;
  const cached = rasterised.get(key);
  if (cached) return cached;
  const w = faceWidth - 2 * ART_INSET;
  const h = faceHeight - 2 * ART_INSET;
  const faces = svgs.map((svg) => (svg && w > 0 && h > 0 ? rasterise(svg, w, h, scale) : null));
  rasterised.set(key, faces);
  if (rasterised.size > MAX_CACHED_SIZES) rasterised.delete(rasterised.keys().next().value!);
  return faces;
}

/**
 * The tile faces for this face size, or null until the SVGs have loaded (the first mount of
 * the app session only; later mounts have them at once).
 */
export function useTileFaces(faceWidth: number, faceHeight: number): TileFaces | null {
  const [svgs, setSvgs] = useState<TileSVGs | null>(decoded);
  useEffect(() => {
    if (svgs) return;
    let mounted = true;
    void loadTileSVGs().then((all) => {
      if (mounted) setSvgs(all);
    });
    return () => {
      mounted = false;
    };
  }, [svgs]);
  return useMemo(
    () => (svgs ? tileFacesFor(svgs, faceWidth, faceHeight) : null),
    [svgs, faceWidth, faceHeight]
  );
}

/** Forget every decoded and rasterised face, as at app start. Tests only. */
export function resetTileFaces(): void {
  decoded = null;
  decoding = null;
  rasterised.clear();
}
