/**
 * Mahjong tile face art for the native canvas (#2962): the 42 SVG faces are decoded once per
 * app session and rasterised once per face size into `SkImage`s, so the board draws each tile
 * face as a bitmap (`<Image>`) instead of re-rendering its SVG (`<ImageSVG>`) on every frame.
 *
 * - Decoding: `loadTileSVGs` reads and parses the faces (module-level), so a later mount (the
 *   canvas unmounts whenever the screen leaves "play") gets the parsed set at once. A face
 *   that failed to load or parse is retried on the next mount, up to `MAX_FACE_ATTEMPTS`
 *   times; the ones that loaded are kept, and the set keeps its identity when nothing changed.
 * - Rasterising: `tileFacesFor` draws each face into a CPU raster surface at the art box's
 *   size times the device pixel ratio (the snapshot is a plain bitmap, no GPU readback), and
 *   keeps the result per size (`faceWidth`x`faceHeight`) in an LRU of `MAX_CACHED_SIZES`
 *   sizes. Each mounted canvas holds the size it draws (`useTileFaces` acquires it and
 *   releases it on a size change or unmount); only a size no canvas holds is evicted, and its
 *   images are disposed then, so the cache can run over its bound while canvases hold more.
 *   `useTileFaces` rasterises after the commit (a timer started in an effect), so a new size
 *   never blocks a render: the canvas draws what it has (placeholders, or the faces of the
 *   size before, scaled) and the new faces follow. A size already cached is returned on the
 *   first render.
 *
 * A face that fails to load or rasterise is null; the canvas draws its suit-colour fallback.
 */
import { useEffect, useLayoutEffect, useState } from "react";
import { PixelRatio } from "react-native";
import { loadData, Skia } from "@shopify/react-native-skia";
import type { SkImage, SkSVG } from "@shopify/react-native-skia";
import { TILE_REQUIRES } from "./tileAssets";

/** Index `faceId - 1`: one entry per face asset, null where it didn't load. */
export type TileFaces = ReadonlyArray<SkImage | null>;
type TileSVGs = ReadonlyArray<SkSVG | null>;

/** The face art sits this far inside the tile face on every side. */
export const ART_INSET = 2;

/** Face sizes kept rasterised once no canvas holds them. */
const MAX_CACHED_SIZES = 4;

/** Loads of one face (the first and two retries) before it stays a placeholder. */
const MAX_FACE_ATTEMPTS = 3;

/** The latest decode result (nulls where a face failed), and the load in flight. */
let decoded: TileSVGs | null = null;
let decoding: Promise<TileSVGs> | null = null;
/** Failed loads per face. */
let failures: number[] = TILE_REQUIRES.map(() => 0);

interface CacheEntry {
  readonly svgs: TileSVGs;
  readonly faces: TileFaces;
  /** Mounted canvases drawing this size: it is not evicted while any do. */
  users: number;
}

/** Rasterised faces per size key, least recently used first. */
const rasterised = new Map<string, CacheEntry>();

function decode(source: number): Promise<SkSVG | null> {
  try {
    return loadData(source, (data) => Skia.SVG.MakeFromData(data)).catch(() => null);
  } catch {
    return Promise.resolve(null);
  }
}

/**
 * Every face's parsed SVG. The first call reads and parses them all; a later call retries
 * the faces that failed (each at most `MAX_FACE_ATTEMPTS` times in all) and keeps the rest.
 * Resolves to the same array as before when nothing changed. Calls during a load share it.
 */
export function loadTileSVGs(): Promise<TileSVGs> {
  const before = decoded;
  const retry = TILE_REQUIRES.map((_, i) => !before?.[i] && failures[i]! < MAX_FACE_ATTEMPTS);
  if (before && !retry.some(Boolean)) return Promise.resolve(before);
  if (!decoding) {
    decoding = Promise.all(
      TILE_REQUIRES.map((src, i) => (retry[i] ? decode(src) : Promise.resolve(before?.[i] ?? null)))
    ).then((all) => {
      all.forEach((svg, i) => {
        if (retry[i] && !svg) failures[i]! += 1;
      });
      const changed = !before || all.some((svg, i) => svg !== before[i]);
      decoded = changed ? all : before;
      decoding = null;
      return decoded;
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

/** Drop least recently used sizes no canvas holds, past the bound, disposing their images. */
function evictUnheld(keep: string): void {
  for (const [key, entry] of rasterised) {
    if (rasterised.size <= MAX_CACHED_SIZES) return;
    if (entry.users > 0 || key === keep) continue;
    rasterised.delete(key);
    for (const face of entry.faces) face?.dispose();
  }
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
  rasterised.set(key, { svgs, faces, users: entry?.users ?? 0 });
  evictUnheld(key);
  return faces;
}

/** `faces` if they are still the cached faces of `key` (so not disposed), else null. */
function liveFaces(key: string, faces: TileFaces): TileFaces | null {
  return rasterised.get(key)?.faces === faces ? faces : null;
}

/** The cached faces for a size, if drawn from `svgs` (no LRU change: safe during a render). */
function peekTileFaces(svgs: TileSVGs | null, key: string): TileFaces | null {
  const entry = rasterised.get(key);
  return svgs && entry && entry.svgs === svgs ? entry.faces : null;
}

/**
 * The tile faces for this face size. Null until the SVGs have loaded (the first mount of the
 * session); a cached size comes back on the first render; a new size is rasterised after the
 * commit, the faces of the size before (or null) standing in until then. The size whose
 * faces are returned is held for this canvas until it draws another or unmounts.
 */
export function useTileFaces(faceWidth: number, faceHeight: number): TileFaces | null {
  const key = sizeKey(faceWidth, faceHeight, PixelRatio.get());
  const [svgs, setSvgs] = useState<TileSVGs | null>(decoded);
  const [drawn, setDrawn] = useState<{ key: string; faces: TileFaces } | null>(() => {
    const faces = peekTileFaces(decoded, key);
    return faces ? { key, faces } : null;
  });

  // Once per mount: the first mount loads every face, a later one retries any that failed
  // (a complete set resolves at once and changes nothing).
  useEffect(() => {
    let mounted = true;
    void loadTileSVGs().then((all) => {
      if (mounted) setSvgs((prev) => (prev === all ? prev : all));
    });
    return () => {
      mounted = false;
    };
  }, []);

  // What to draw, from cached faces only: this size's, else the size before as a stand-in.
  let shown: { key: string; faces: TileFaces } | null = null;
  const own = (drawn?.key === key ? liveFaces(key, drawn.faces) : null) ?? peekTileFaces(svgs, key);
  if (own) shown = { key, faces: own };
  else if (drawn && liveFaces(drawn.key, drawn.faces)) shown = drawn;
  const shownKey = shown?.key ?? null;

  // Hold the drawn size from the commit on, so no other canvas's eviction disposes it.
  useLayoutEffect(() => {
    const held = shownKey === null ? undefined : rasterised.get(shownKey);
    if (!held) return;
    held.users += 1;
    return () => {
      // A retried load can replace the entry; it carries the count over.
      const entry = rasterised.get(shownKey!);
      if (entry) entry.users -= 1;
    };
  }, [shownKey]);

  // Rasterise a size (or new faces) after the commit, never during a render.
  useEffect(() => {
    if (!svgs) return;
    const timer = setTimeout(() => {
      const faces = tileFacesFor(svgs, faceWidth, faceHeight);
      const k = sizeKey(faceWidth, faceHeight, PixelRatio.get());
      setDrawn((prev) => (prev?.key === k && prev.faces === faces ? prev : { key: k, faces }));
    }, 0);
    return () => clearTimeout(timer);
  }, [svgs, faceWidth, faceHeight]);

  return shown?.faces ?? null;
}

/** Forget every decoded and rasterised face, as at app start. Tests only. */
export function resetTileFaces(): void {
  decoded = null;
  decoding = null;
  failures = TILE_REQUIRES.map(() => 0);
  rasterised.clear();
}
