/**
 * #2963: the native canvas's background and starfield, recorded once instead of re-emitted into
 * every frame's display list.
 *
 * Stars never change after `initStarfield` (no twinkle, constant opacity); each of the three depth
 * layers scrolls at its own speed and wraps at the bottom edge. So each layer is recorded once
 * into its own Picture and slid down by its offset on the UI thread (`layerTransform`), drawn
 * twice — once at the offset and once a canvas-height above it — so the stars that wrap off the
 * bottom re-enter at the top exactly where the old per-star wrap put them. Under the layers sits
 * the background fill that used to be the display list's first op. `buildFrame`'s list is drawn
 * on top, so the z-order is unchanged: background, far → near stars, then the scene.
 */
import { Skia, createPicture } from "@shopify/react-native-skia";
import type { SkPicture } from "@shopify/react-native-skia";
import { layerOffset, starLayers } from "../starfield";
import type { StarfieldState } from "../starfield";
import { withAlpha } from "./color";
import { BG, WHITE_RGB } from "./palette";

/** The scene's background, under everything. */
export const BACKGROUND = BG;

export interface StarfieldPictures {
  readonly backdrop: SkPicture;
  readonly layers: readonly { readonly speed: number; readonly picture: SkPicture }[];
}

/** Record the background and one Picture per depth layer, at the layer's starting positions. */
export function recordStarfield(sf: StarfieldState): StarfieldPictures {
  const size = { width: sf.width, height: sf.height };
  const backdrop = createPicture((canvas) => {
    canvas.drawColor(Skia.Color(BACKGROUND));
  }, size);
  const layers = starLayers(sf).map((layer) => ({
    speed: layer.speed,
    picture: createPicture((canvas) => {
      const paint = Skia.Paint();
      paint.setAntiAlias(true);
      for (const star of layer.stars) {
        paint.setColor(Skia.Color(withAlpha(WHITE_RGB, star.opacity)));
        canvas.drawCircle(star.x, star.y, star.r, paint);
      }
    }, size),
  }));
  return { backdrop, layers };
}

/**
 * Free the native Pictures `recordStarfield` made. The owner calls this once nothing draws them any
 * more (StarfieldLayers: in the effect cleanup after a re-record has been committed, and on
 * unmount).
 */
export function disposeStarfield(pictures: StarfieldPictures): void {
  pictures.backdrop.dispose();
  for (const layer of pictures.layers) layer.picture.dispose();
}

/** The transform that slides a layer to where it has scrolled after `elapsedMs`. */
export function layerTransform(
  elapsedMs: number,
  speed: number,
  height: number
): { translateY: number }[] {
  "worklet";
  return [{ translateY: layerOffset(elapsedMs, speed, height) }];
}
