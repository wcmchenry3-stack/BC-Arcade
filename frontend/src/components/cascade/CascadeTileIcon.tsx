/**
 * The Cascade tile's icon on the home screen (#3698): the Watermelon, drawn by the same code as
 * the board's pieces (`FruitGlyph`). Skia is loaded on demand, so it never delays the home
 * screen's first paint (the lazy game screens defer it the same way); until it is ready, or if it
 * cannot load, the tile shows `fallback` (the 🍉 emoji it always had). On web, where Skia needs
 * CanvasKit and only Cascade loads it, `CascadeTileIcon.web.tsx` shows the fallback.
 */
import React, { Suspense, type ReactNode } from "react";
import { View } from "react-native";

/** Tier 10 of the Fruits set. */
const WATERMELON = { set: "fruits", tier: 10 } as const;

export interface CascadeTileIconProps {
  /** Square size, points. */
  readonly size: number;
  /** Shown while the art loads, and instead of it if it cannot. */
  readonly fallback: ReactNode;
  readonly testID?: string;
}

interface GlyphProps {
  readonly size: number;
  readonly fallback: ReactNode;
}

// A deferred `require`, not `import()`: Metro bundles both the same way on native (Skia's
// module runs on first use, not at start-up), and Jest can follow it.
const Glyph = React.lazy(() =>
  Promise.resolve()
    .then(
      () => require("./FruitGlyph") as typeof import("./FruitGlyph") // eslint-disable-line @typescript-eslint/no-require-imports
    )
    .then(
      ({ default: FruitGlyph }) => ({
        default: ({ size }: GlyphProps) => <FruitGlyph fruit={WATERMELON} size={size} />,
      }),
      () => ({ default: ({ fallback }: GlyphProps) => <>{fallback}</> })
    )
);

export default function CascadeTileIcon({ size, fallback, testID }: CascadeTileIconProps) {
  return (
    <Suspense fallback={fallback}>
      <View testID={testID} accessible={false}>
        <Glyph size={size} fallback={fallback} />
      </View>
    </Suspense>
  );
}
