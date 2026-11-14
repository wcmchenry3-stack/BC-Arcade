/**
 * Web: the Cascade tile keeps its emoji (#3698). Skia on web needs CanvasKit (about 3 MB), which
 * only the Cascade screen loads; the home screen must not pay for it. Native draws the piece
 * (`CascadeTileIcon.tsx`).
 */
import type { CascadeTileIconProps } from "./CascadeTileIcon";

export default function CascadeTileIcon({ fallback }: CascadeTileIconProps) {
  return <>{fallback}</>;
}
