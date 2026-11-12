/**
 * Loads the Cascade screen on web (#2960): Skia's web runtime (CanvasKit) first, then the screen
 * in its own chunk. `react-native-skia`'s web module reads `global.CanvasKit` when it is first
 * evaluated, so the screen, which imports Skia, must not be imported before CanvasKit is loaded.
 *
 * Its own module so the route's tests can stand in for `import()`, which Jest cannot run.
 */
import type { ComponentType } from "react";
import { loadCanvasKit } from "../game/cascade/render/loadCanvasKit";

export async function loadCascadeScreen(): Promise<ComponentType> {
  await loadCanvasKit();
  const screen = await import("./CascadeScreen");
  return screen.default;
}
