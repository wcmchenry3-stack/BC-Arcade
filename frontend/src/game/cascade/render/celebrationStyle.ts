/**
 * #3699: builds what the win celebration draws with (`drawCelebration.ts`), once per board key, on
 * the JS thread, ahead of the win when it can (`celebrationStyleFor`): the capstone's bitmaps (rasterised bigger,
 * `art/sprites.ts`'s `capstoneSprite`), the paths, the gradients and the twinkle and star tables.
 * The UI thread only reads it.
 */
import { Skia, TileMode } from "@shopify/react-native-skia";
import type { SkImage, SkShader } from "@shopify/react-native-skia";
import { CASCADE_CELEBRATION, CASCADE_PIECE_COLORS } from "../../../theme/theme.cascade";
import { BIN_FLOOR_TOP, BIN_INNER_LEFT, BIN_INNER_RIGHT } from "../art/bin";
import { rgba } from "../art/pen";
import { capstoneSprite, quantizePx } from "../art/sprites";
import type { CapstoneSprite, PieceSprite, SpriteRect } from "../art/sprites";
import { RAY_WIDTH, swirlTable, twinkleTable } from "../celebration";
import { CAPSTONE_TIER, tierDrawnRadius } from "../tiers";
import type { CelebrationImage, CelebrationStyle } from "./drawCelebration";

/** Where the halo's core colour has faded into its outer colour (of its radius). */
const GLOW_MID = 0.55;
/** Where the rays start to fade (of their length). */
const RAY_FADE_FROM = 0.35;

function layer(image: SkImage | undefined, rect: SpriteRect): CelebrationImage | null {
  if (!image) return null;
  return {
    image,
    src: Skia.XYWHRect(0, 0, image.width(), image.height()),
    dst: Skia.XYWHRect(rect[0], rect[1], rect[2], rect[3]),
  };
}

/** A radial gradient of radius 1 around (0, 0). */
function unitRadial(colors: Float32Array[], pos: number[]): SkShader {
  return Skia.Shader.MakeRadialGradient(Skia.Point(0, 0), 1, colors, pos, TileMode.Clamp);
}

export interface CelebrationStyleInput {
  readonly setId: string;
  readonly theme: "light" | "dark";
  readonly reduceMotion: boolean;
  /**
   * The capstone's bitmaps: the bigger raster with its cheering face, or (if that could not be
   * made) the board's own, without it.
   */
  readonly sprite: CapstoneSprite | PieceSprite | null;
}

/**
 * What the celebration draws with, or null if Skia could not build it (no Skia in this runtime):
 * the board then draws no celebration, and the card still follows on time.
 */
export function buildCelebrationStyle(input: CelebrationStyleInput): CelebrationStyle | null {
  try {
    return build(input);
  } catch {
    return null;
  }
}

function build({ setId, theme, reduceMotion, sprite }: CelebrationStyleInput): CelebrationStyle {
  const set = CASCADE_CELEBRATION.sets[setId === "cosmos" ? "cosmos" : "fruits"];
  const colors = CASCADE_CELEBRATION.themes[theme];
  const sparkle = Skia.PathBuilder.Make();
  sparkle.moveTo(0, -1);
  sparkle.quadTo(0, 0, 1, 0);
  sparkle.quadTo(0, 0, 0, 1);
  sparkle.quadTo(0, 0, -1, 0);
  sparkle.quadTo(0, 0, 0, -1);
  sparkle.close();
  const ray = Skia.PathBuilder.Make();
  ray.moveTo(0, 0);
  ray.lineTo(1, 0);
  ray.lineTo(Math.cos(RAY_WIDTH), Math.sin(RAY_WIDTH));
  ray.close();
  const cheer = sprite && "cheer" in sprite ? sprite.cheer : undefined;
  return {
    kind: setId === "cosmos" ? "swirl" : "rays",
    reduceMotion,
    tier: CAPSTONE_TIER,
    radius: tierDrawnRadius(CAPSTONE_TIER),
    body: sprite ? layer(sprite.body, sprite.rect) : null,
    light: sprite ? layer(sprite.light, sprite.lightRect) : null,
    top: sprite ? layer(sprite.top, sprite.rect) : null,
    cheer: sprite ? layer(cheer, sprite.rect) : null,
    placeholder: CASCADE_PIECE_COLORS[CAPSTONE_TIER] ?? CASCADE_PIECE_COLORS[0],
    dim: colors.dim,
    ring: colors.ring,
    rays: set.rays,
    glow: set.glow,
    sparkle: set.sparkle,
    dimRect: Skia.XYWHRect(BIN_INNER_LEFT, 0, BIN_INNER_RIGHT - BIN_INNER_LEFT, BIN_FLOOR_TOP),
    glowShader: unitRadial(
      [rgba(set.glowCore, 0.9), rgba(set.glow, 0.55), rgba(set.glow, 0)],
      [0, GLOW_MID, 1]
    ),
    rayShader: unitRadial([rgba(set.rays, 0.55), rgba(set.rays, 0)], [RAY_FADE_FROM, 1]),
    rayPath: ray.build(),
    sparklePath: sparkle.build(),
    twinkles: twinkleTable(),
    swirl: swirlTable(),
  };
}

/** Built styles kept (set x theme x pixel scale), least recently used dropped first. */
export const MAX_CELEBRATION_STYLES = 2;
/** Per key: the style, or null where it could not be built (remembered, not retried). */
const styleCache = new Map<string, CelebrationStyle | null>();
let lastBuildMs: number | null = null;

export interface CelebrationStyleKey {
  readonly setId: string;
  readonly theme: "light" | "dark";
  /** The board's bitmap pixels per world unit (`CascadeBoard`'s `pxPerUnit`). */
  readonly pxPerUnit: number;
}

/** The cache key of a style: its set, theme and (rounded) pixel scale. */
export function celebrationStyleKey({ setId, theme, pxPerUnit }: CelebrationStyleKey): string {
  return `${setId}|${theme}|${quantizePx(pxPerUnit)}`;
}

/**
 * The celebration's style for a board (#3699), built on the first call for its key and cached:
 * the capstone's 1.4x raster with its cheering face (or `fallback`, the board's own capstone, if
 * that could not be made), then the paths, gradients and tables. Its `reduceMotion` is false: the
 * board sets its own. `useCelebrationStyle` asks for it in idle time once the board holds a tier-9
 * piece, so the win itself normally does no raster work.
 */
export function celebrationStyleFor(
  key: CelebrationStyleKey,
  fallback: PieceSprite | null
): CelebrationStyle | null {
  const k = celebrationStyleKey(key);
  if (styleCache.has(k)) {
    const hit = styleCache.get(k) ?? null;
    styleCache.delete(k);
    styleCache.set(k, hit);
    return hit;
  }
  const t0 = Date.now();
  const style = buildCelebrationStyle({
    setId: key.setId,
    theme: key.theme,
    reduceMotion: false,
    sprite: capstoneSprite(key.setId, key.pxPerUnit) ?? fallback,
  });
  lastBuildMs = Date.now() - t0;
  styleCache.set(k, style);
  for (const old of styleCache.keys()) {
    if (styleCache.size <= MAX_CELEBRATION_STYLES) break;
    styleCache.delete(old);
  }
  return style;
}

/** How long the last style build took (ms), for the dev log and tests; null before the first. */
export function lastCelebrationBuildMs(): number | null {
  return lastBuildMs;
}

/** @internal Test seam: forget the built styles. */
export function __resetCelebrationStylesForTests(): void {
  styleCache.clear();
  lastBuildMs = null;
}
