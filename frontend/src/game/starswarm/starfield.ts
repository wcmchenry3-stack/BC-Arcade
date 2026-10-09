import { createSeededRng } from "../_shared/seededRng";

export interface Star {
  id: number;
  x: number;
  /** Starting y; where it is drawn now is `starY` (it scrolls with its layer). */
  y: number;
  /** Logical radius in canvas pixels. */
  r: number;
  /** 0–1 alpha. */
  opacity: number;
  /** Downward scroll speed in px/ms. */
  speed: number;
}

/**
 * #2963: the stars never change after `initStarfield` — every star in a depth layer scrolls at
 * that layer's speed and wraps at the bottom edge — so the state is the fixed layout plus one
 * scroll clock. A layer's offset is `layerOffset(elapsedMs, speed, height)`; the native canvas
 * records each layer once as a Picture and slides it by that offset on the UI thread, and
 * `starY` gives one star's position for the web canvas. Ticking allocates one small object (the
 * new identity is what tells the frame gate the starfield moved), not a copy of every star.
 */
export interface StarfieldState {
  readonly stars: readonly Star[];
  readonly width: number;
  readonly height: number;
  /** How long the starfield has scrolled, ms. */
  readonly elapsedMs: number;
}

// Three depth layers: far (slow/dim/tiny), mid, near (fast/bright/large).
const LAYERS = [
  { count: 50, speed: 0.02, r: 0.6, opacity: 0.35 },
  { count: 30, speed: 0.05, r: 1.0, opacity: 0.65 },
  { count: 15, speed: 0.1, r: 1.4, opacity: 1.0 },
] as const;

export function initStarfield(width: number, height: number, seed = 42): StarfieldState {
  const rand = createSeededRng(seed);
  const stars: Star[] = [];
  let id = 0;
  for (const layer of LAYERS) {
    for (let i = 0; i < layer.count; i++) {
      stars.push({
        id: id++,
        x: rand() * width,
        y: rand() * height,
        r: layer.r,
        opacity: layer.opacity,
        speed: layer.speed,
      });
    }
  }
  return { stars, width, height, elapsedMs: 0 };
}

export function tickStarfield(state: StarfieldState, dtMs: number): StarfieldState {
  return { ...state, elapsedMs: state.elapsedMs + dtMs };
}

/** How far a layer moving at `speed` px/ms has scrolled after `elapsedMs`, in [0, height). */
export function layerOffset(elapsedMs: number, speed: number, height: number): number {
  "worklet";
  return height > 0 ? (elapsedMs * speed) % height : 0;
}

/** Where `star` is drawn now: its start plus its layer's offset, wrapped to the top. */
export function starY(star: Star, sf: StarfieldState): number {
  const y = star.y + layerOffset(sf.elapsedMs, star.speed, sf.height);
  return y > sf.height ? y - sf.height : y;
}

export interface StarLayer {
  readonly speed: number;
  /** In draw order (back to front within the layer). */
  readonly stars: readonly Star[];
}

/** The stars grouped by depth layer (scroll speed), far layer first — the draw order. */
export function starLayers(sf: StarfieldState): StarLayer[] {
  const layers: { speed: number; stars: Star[] }[] = [];
  for (const star of sf.stars) {
    let layer = layers.find((l) => l.speed === star.speed);
    if (!layer) {
      layer = { speed: star.speed, stars: [] };
      layers.push(layer);
    }
    layer.stars.push(star);
  }
  return layers;
}
