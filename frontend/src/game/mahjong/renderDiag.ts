/**
 * Mahjong render diagnostics (#3684, iOS "tiles look faded and blurry"). Test builds only
 * (`EXPO_PUBLIC_TEST_HOOKS=1`, the Maestro builds): in any other build every function here
 * is inert — `getRenderVariant()` is always "c" (the fixed renderer, #3684), the `note*`
 * recorders return at once, and the screen never mounts the readout.
 *
 * Two parts:
 *
 * - **Render variants**, chosen by a Maestro flow before a deal: (c) the production renderer
 *   since #3684 — the canvas at the board's own size, the extra resolution kept for the face
 *   bitmaps only; (a) the OLD renderer, an oversized canvas scaled down by a View transform,
 *   which iOS stopped presenting and aliased — test builds only, a before/after switch for
 *   the demo; (b) no extra resolution at all. `canvasPlan` turns a variant into the numbers
 *   the native canvas draws with.
 * - **Counters**, written by the deal-in (`useBoardMotion`), the face rasteriser
 *   (`tileFaces`) and the canvas, and read by the readout (`MahjongRenderDiag`) twice a
 *   second. Module state only: no storage, no network, no Sentry.
 */
import { useSyncExternalStore } from "react";
import { areTestHooksEnabled } from "../_shared/envFlags";

/**
 * c: the fixed production renderer (board-size canvas, faces at res); a: the old oversized
 * canvas (#3611, test builds only); b: resolution 1.
 */
export type RenderVariant = "a" | "b" | "c";
/** The variant production always draws with (#3684). */
export const PRODUCTION_VARIANT: RenderVariant = "c";
/** The readout's buttons, the fixed renderer first. */
export const RENDER_VARIANTS: readonly RenderVariant[] = ["c", "a", "b"];
/** The readout's button labels. */
export const VARIANT_LABELS: Readonly<Record<RenderVariant, string>> = {
  c: "fixed (c)",
  a: "old (a)",
  b: "res1 (b)",
};

/** Whether diagnostics run at all: test builds only. Read at call time, never at import. */
export function isRenderDiagEnabled(): boolean {
  return areTestHooksEnabled();
}

let variant: RenderVariant = PRODUCTION_VARIANT;

/** The variant the native canvas draws with: always the production one outside a test build. */
export function getRenderVariant(): RenderVariant {
  return isRenderDiagEnabled() ? variant : PRODUCTION_VARIANT;
}

const listeners = new Set<() => void>();
const subscribeVariant = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** Picks the variant for the next deal (test builds only; a no-op otherwise, nothing notified). */
export function setRenderVariant(next: RenderVariant): void {
  if (!isRenderDiagEnabled()) return;
  if (variant === next) return;
  variant = next;
  listeners.forEach((l) => l());
}

/**
 * The variant as a subscribed value: a component using it re-renders when a test build picks
 * another. Outside a test build it is always "c" and never notifies (`setRenderVariant` is a
 * no-op there), so the subscription costs nothing.
 */
export function useRenderVariant(): RenderVariant {
  return useSyncExternalStore(subscribeVariant, getRenderVariant, () => PRODUCTION_VARIANT);
}

/** How the native canvas turns the board's resolution into sizes and transforms. */
export interface CanvasPlan {
  /** Board units to canvas units, applied by each tile's group (the `res` prop). */
  readonly tileRes: number;
  /** The canvas's size, in multiples of the board's. */
  readonly canvasScale: number;
  /** The View scale that shrinks the canvas back onto the board. */
  readonly viewScale: number;
  /** The face bitmaps' resolution, times the device pixel ratio (`useTileFaces`). */
  readonly faceRes: number;
}

/** The plan for `v` at board resolution `res` (`boardResolution(...)`, never below 1). */
export function canvasPlan(v: RenderVariant, res: number): CanvasPlan {
  switch (v) {
    case "b":
      return { tileRes: 1, canvasScale: 1, viewScale: 1, faceRes: 1 };
    case "a":
      // The old #3611 renderer: iOS stops presenting this layer and aliases it (#3684).
      return { tileRes: res, canvasScale: res, viewScale: 1 / res, faceRes: res };
    default:
      // "c", production: a board-size canvas, faces rasterised at res for zoom.
      return { tileRes: 1, canvasScale: 1, viewScale: 1, faceRes: res };
  }
}

/** The canvas's backing size in physical pixels. */
export function canvasPixels(
  plan: CanvasPlan,
  boardWidth: number,
  boardHeight: number,
  pixelRatio: number
): { width: number; height: number } {
  const k = plan.canvasScale * pixelRatio;
  return { width: Math.round(boardWidth * k), height: Math.round(boardHeight * k) };
}

// ---------------------------------------------------------------------------
// Counters
// ---------------------------------------------------------------------------

/** The latest deal's clock progress, as read from JS. */
interface ProgressRef {
  readonly value: number;
}

export interface FaceRaster {
  /** The size key (`WxH@scale`). */
  readonly key: string;
  readonly ms: number;
  readonly ready: number;
  readonly nulls: number;
}

export interface CanvasNote {
  readonly variant: RenderVariant;
  /** `boardResolution`, before the variant applies. */
  readonly res: number;
  readonly plan: CanvasPlan;
  readonly boardWidth: number;
  readonly boardHeight: number;
  /** Faces the canvas drew this render: -1 while none (the suit-colour fallback). */
  readonly facesReady: number;
}

interface Counters {
  dealsStarted: number;
  dealTimersFired: number;
  dealsSkipped: number;
  dealProgress: ProgressRef | null;
  lastRaster: FaceRaster | null;
  rasters: number;
  canvas: CanvasNote | null;
}

const fresh = (): Counters => ({
  dealsStarted: 0,
  dealTimersFired: 0,
  dealsSkipped: 0,
  dealProgress: null,
  lastRaster: null,
  rasters: 0,
  canvas: null,
});

let counters: Counters = fresh();

/** A deal-in started (`useBoardMotion.dealIn`), with its clock. */
export function noteDealStart(progress: ProgressRef): void {
  if (!isRenderDiagEnabled()) return;
  counters.dealsStarted += 1;
  counters.dealProgress = progress;
}

/** The deal-in's end timer (`later(DEAL_IN_MS, ...)`) ran on the JS thread. */
export function noteDealTimerFired(): void {
  if (!isRenderDiagEnabled()) return;
  counters.dealTimersFired += 1;
}

/** A tap skipped the deal (`skipDeal`). */
export function noteDealSkipped(): void {
  if (!isRenderDiagEnabled()) return;
  counters.dealsSkipped += 1;
}

/** One rasterisation pass of the faces (`useTileFaces`'s timer). */
export function noteFaceRaster(raster: FaceRaster): void {
  if (!isRenderDiagEnabled()) return;
  counters.rasters += 1;
  counters.lastRaster = raster;
}

/** What the native canvas drew with, on its latest render. */
export function noteCanvas(note: CanvasNote): void {
  if (!isRenderDiagEnabled()) return;
  counters.canvas = note;
}

/** A copy of the counters, the deal's progress read now. */
export interface DiagSnapshot {
  readonly dealsStarted: number;
  readonly dealTimersFired: number;
  readonly dealsSkipped: number;
  /** null before any deal. */
  readonly dealProgress: number | null;
  readonly lastRaster: FaceRaster | null;
  readonly rasters: number;
  readonly canvas: CanvasNote | null;
}

export function diagSnapshot(): DiagSnapshot {
  let dealProgress: number | null = null;
  try {
    dealProgress = counters.dealProgress ? counters.dealProgress.value : null;
  } catch {
    dealProgress = Number.NaN;
  }
  return {
    dealsStarted: counters.dealsStarted,
    dealTimersFired: counters.dealTimersFired,
    dealsSkipped: counters.dealsSkipped,
    dealProgress,
    lastRaster: counters.lastRaster,
    rasters: counters.rasters,
    canvas: counters.canvas,
  };
}

/**
 * Forget every counter and the chosen variant. Tests only.
 * @internal Exported for tests only; no production caller (knip --production, #3126).
 */
export function resetRenderDiag(): void {
  counters = fresh();
  variant = PRODUCTION_VARIANT;
  listeners.forEach((l) => l());
}

// ---------------------------------------------------------------------------
// The readout's text
// ---------------------------------------------------------------------------

/** What the screen knows, merged with the snapshot into the readout. */
export interface DiagLive {
  readonly pixelRatio: number;
  readonly motionTiles: number;
  readonly dealing: boolean;
  readonly reduceMotion: boolean;
  /** ms since the readout mounted (the JS heartbeat). */
  readonly jsMs: number;
  /** UI-thread frames counted by the frame callback; null while it is off. */
  readonly uiFrames: number | null;
}

const fix = (n: number, d: number): string => (Number.isFinite(n) ? n.toFixed(d) : "NaN");

/** The readout, one fact group per line, short enough for a phone screenshot. */
export function formatDiag(s: DiagSnapshot, live: DiagLive): string[] {
  const c = s.canvas;
  const px = c ? canvasPixels(c.plan, c.boardWidth, c.boardHeight, live.pixelRatio) : null;
  const r = s.lastRaster;
  return [
    c
      ? `v=${c.variant} res=${fix(c.res, 2)} pr=${live.pixelRatio} canvas=${px!.width}x${px!.height}px`
      : `v=? (no canvas yet) pr=${live.pixelRatio}`,
    `motion=${live.motionTiles} dealing=${live.dealing ? "Y" : "n"} p=${
      s.dealProgress === null ? "-" : fix(s.dealProgress, 3)
    }`,
    `deals=${s.dealsStarted} dealTimer=${s.dealTimersFired} skip=${s.dealsSkipped}`,
    `ui=${live.uiFrames === null ? "off" : `${live.uiFrames}f`} js=${fix(live.jsMs / 1000, 1)}s`,
    `faces drawn=${c ? (c.facesReady < 0 ? "none" : c.facesReady) : "-"} raster#${s.rasters} ${
      r ? `${r.ready}ok/${r.nulls}null ${Math.round(r.ms)}ms ${r.key}` : "-"
    }`,
    `reduceMotion=${live.reduceMotion ? "ON" : "off"}`,
  ];
}
