/**
 * Mahjong tile face art for the native canvas (#2962): the 42 SVG faces are decoded once per
 * app session and rasterised once per face size into `SkImage`s, so the board draws each tile
 * face as a bitmap (`<Image>`) instead of re-rendering its SVG (`<ImageSVG>`) on every frame.
 *
 * - Decoding: `loadTileSVGs` reads and parses the faces (module-level), so a later mount (the
 *   canvas unmounts whenever the screen leaves "play") gets the parsed set at once. A face
 *   that failed to load or parse is retried on the next mount; the ones that loaded are kept.
 * - Rasterising: `tileFacesFor` draws each face into a CPU raster surface at the art box's
 *   size times the device pixel ratio (the snapshot is a plain bitmap, no GPU readback), and
 *   keeps the result per size (`faceWidth`x`faceHeight`) in an LRU of `MAX_CACHED_SIZES`
 *   sizes; an evicted size's images are disposed. `useTileFaces` rasterises after the commit
 *   (a timer started in an effect), so a new size never blocks a render: the canvas draws
 *   what it has (placeholders, or the faces of the size before, scaled) and the new faces
 *   follow. A size already cached is returned on the first render.
 *
 * A face that fails to load or rasterise is null; the canvas draws its suit-colour fallback.
 */
import { useEffect, useState } from "react";
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

/** The latest decode result (nulls where a face failed), and the load in flight. */
let decoded: TileSVGs | null = null;
let decoding: Promise<TileSVGs> | null = null;

/** Rasterised faces per size key, least recently used first; each with the SVGs drawn. */
const rasterised = new Map<string, { readonly svgs: TileSVGs; readonly faces: TileFaces }>();

const isComplete = (svgs: TileSVGs | null): svgs is TileSVGs =>
  svgs !== null && svgs.every((svg) => svg !== null);

function decode(source: number): Promise<SkSVG | null> {
  try {
    return loadData(source, (data) => Skia.SVG.MakeFromData(data)).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Every face's parsed SVG. Faces already parsed are kept; the rest (all of them, the first
 * time) are read and parsed now. Calls during a load share it.
 */
export function loadTileSVGs(): Promise<TileSVGs> {
  if (isComplete(decoded)) return Promise.resolve(decoded);
  if (!decoding) {
    const before = decoded;
    decoding = Promise.all(
      TILE_REQUIRES.map((src, i) => {
        const kept = before?.[i];
        return kept ? Promise.resolve(kept) : decode(src);
      })
    ).then((all) => {
      decoded = all;
      decoding = null;
      return all;
    });
  }
  return decoding;
}

/** `svg` drawn into a w x h box, as a bitmap of `scale` pixels per point. */
function rasterise(svg: SkSVG, w: number, h: number, scale: number): SkImage | null {
  const pw = Math.ceil(w * scale);
  const ph = Math.ceil(h * scale);
  // A CPU raster surface: its snapshot is a plain bitmap any canvas can draw.
  const surface = Skia.Surface.Make(pw, ph);
  if (!surface) return null;
  try {
    const canvas = surface.getCanvas();
    canvas.scale(pw / w, ph / h);
    canvas.drawSvg(svg, w, h);
    surface.flush();
    return surface.makeImageSnapshot();
  } catch {
    return null; // an SVG Skia cannot draw gets the suit-colour fallback
  } finally {
    surface.dispose();
  }
}

function sizeKey(faceWidth: number, faceHeight: number, scale: number): string {
  return `${faceWidth}x${faceHeight}@${scale}`;
}

/** The cached faces for a size, if `svgs` are the ones they were drawn from (no LRU touch). */
function peekTileFaces(svgs: TileSVGs, key: string): TileFaces | null {
  const entry = rasterised.get(key);
  return entry && entry.svgs === svgs ? entry.faces : null;
}

/**
 * The faces for tiles of `faceWidth` x `faceHeight`, rasterised on the first call for that
 * size (and pixel ratio) and cached after it, as the most recently used size. When `svgs`
 * gained faces since (a retried load), only the new faces are drawn.
 */
export function tileFacesFor(
  svgs: TileSVGs,
  faceWidth: number,
  faceHeight: number,
  scale: number = PixelRatio.get()
): TileFaces {
  const key = sizeKey(faceWidth, faceHeight, scale);
  const entry = rasterised.get(key);
  rasterised.delete(key); // re-inserted below: most recently used last
  if (entry && entry.svgs === svgs) {
    rasterised.set(key, entry);
    return entry.faces;
  }
  const w = faceWidth - 2 * ART_INSET;
  const h = faceHeight - 2 * ART_INSET;
  const faces = svgs.map((svg, i) => {
    if (entry && entry.svgs[i] === svg && entry.faces[i]) return entry.faces[i]!;
    return svg && w > 0 && h > 0 ? rasterise(svg, w, h, scale) : null;
  });
  rasterised.set(key, { svgs, faces });
  while (rasterised.size > MAX_CACHED_SIZES) {
    const [oldest, evicted] = rasterised.entries().next().value!;
    rasterised.delete(oldest);
    for (const face of evicted.faces) face?.dispose();
  }
  return faces;
}

/**
 * The tile faces for this face size. Null until the SVGs have loaded (the first mount of the
 * session); a cached size comes back on the first render; a new size is rasterised after the
 * commit, the faces of the size before (or null) standing in until then.
 */
export function useTileFaces(faceWidth: number, faceHeight: number): TileFaces | null {
  const [svgs, setSvgs] = useState<TileSVGs | null>(decoded);
  const [drawn, setDrawn] = useState<{ key: string; faces: TileFaces } | null>(null);
  const key = sizeKey(faceWidth, faceHeight, PixelRatio.get());

  // Load once per mount: the first mount loads every face, a later one retries any that failed.
  useEffect(() => {
    if (isComplete(decoded)) return;
    let mounted = true;
    void loadTileSVGs().then((all) => {
      if (mounted) setSvgs(all);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const current = drawn?.key === key ? drawn.faces : svgs ? peekTileFaces(svgs, key) : null;

  // Rasterise a size (or new faces) after the commit, never during a render.
  useEffect(() => {
    if (!svgs) return;
    // A cached size only marks it most recently used here (the render already returned it),
    // and keeps it as the stand-in for a later size change.
    const timer = setTimeout(() => {
      setDrawn({ key, faces: tileFacesFor(svgs, faceWidth, faceHeight) });
    }, 0);
    return () => clearTimeout(timer);
  }, [svgs, key, faceWidth, faceHeight]);

  return current ?? drawn?.faces ?? null;
}

/** Forget every decoded and rasterised face, as at app start. Tests only. */
export function resetTileFaces(): void {
  decoded = null;
  decoding = null;
  rasterised.clear();
}
