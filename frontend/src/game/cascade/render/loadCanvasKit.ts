/**
 * Loads Skia's web runtime (CanvasKit) for Cascade on web (#2960, owner decision 2026-11-11).
 *
 * Cascade draws with `@shopify/react-native-skia` on every platform. On iOS and Android Skia is
 * native; on web it runs on CanvasKit, Skia compiled to WebAssembly. `react-native-skia`'s web
 * module builds its `Skia` API from `global.CanvasKit` when it is first evaluated, so CanvasKit
 * must be on the global before any Skia-importing module runs. `screens/CascadeRoute.web.tsx`
 * calls this, then imports the Cascade screen. Nothing else on web loads it: the other web games
 * draw with Canvas 2D.
 *
 * Only web code imports this file, so native bundles never contain it, the CanvasKit loader or
 * the `.wasm` (`canvasKitWeb.test.ts` fails if a non-web file imports it).
 *
 * The same steps as Skia's `LoadSkiaWeb` (`lib/module/web/LoadSkiaWeb.js`), with two changes:
 *  - `locateFile` points at the `.wasm` Metro bundles as an asset, so it is served from our own
 *    origin (hashed under `dist/assets/`), never a CDN, and is the exact file of the installed
 *    `canvaskit-wasm` (the version `@shopify/react-native-skia` pins; `canvasKitWeb.test.ts`
 *    keeps them equal);
 *  - a failed load can be retried. `LoadSkiaWeb` keeps its first promise even when it rejects, so
 *    one dropped download would break Cascade until the page reloads.
 */
import CanvasKitInit from "canvaskit-wasm/bin/full/canvaskit";
import type { CanvasKit } from "canvaskit-wasm";
import { Asset } from "expo-asset";

import CANVASKIT_WASM from "canvaskit-wasm/bin/full/canvaskit.wasm";

/**
 * How long one attempt may take before the screen shows its error and Retry (no endless
 * spinner, #2539). The download is ~3.2 MB gzipped (docs/PERFORMANCE.md), about a minute on
 * a slow 3G link. A timed-out download keeps going: Retry waits for the same one.
 */
export const CANVASKIT_LOAD_TIMEOUT_MS = 60_000;

type CanvasKitGlobal = { CanvasKit?: CanvasKit };

let pending: Promise<CanvasKit> | null = null;

/** The URL of the bundled `canvaskit.wasm` on this origin. */
function locateFile(): string {
  return Asset.fromModule(CANVASKIT_WASM).uri;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`CanvasKit did not load within ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/**
 * Resolves once `global.CanvasKit` is set. Rejects if the download or the WebAssembly start-up
 * fails, or takes longer than `timeoutMs`; calling it again then retries a failed load or keeps
 * waiting for one still in flight.
 */
export function loadCanvasKit(timeoutMs: number = CANVASKIT_LOAD_TIMEOUT_MS): Promise<void> {
  const g = globalThis as CanvasKitGlobal;
  if (g.CanvasKit !== undefined) return Promise.resolve();
  pending ??= CanvasKitInit({ locateFile }).then(
    (canvasKit) => {
      g.CanvasKit = canvasKit;
      return canvasKit;
    },
    (error: unknown) => {
      pending = null;
      throw error;
    }
  );
  return withTimeout(pending, timeoutMs).then(() => undefined);
}

/** @internal Test seam: forget an in-flight or failed load between tests. */
export function __resetCanvasKitLoaderForTests(): void {
  pending = null;
}
