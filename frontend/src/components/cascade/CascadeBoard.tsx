/**
 * The Cascade board (#2960): one Skia `Picture`, recorded on the UI thread from the frame the
 * screen's loop publishes to `frame` (a shared value; layout in `game/cascade/render/frame.ts`).
 *
 * It replaces the declarative `PieceRenderer` that lived in `CascadeScreen.tsx` and re-rendered
 * through React state every frame. React renders this component only when its props change (the
 * board's scale, the fruit set, the theme, a sprite finishing decoding); a new frame re-records
 * the Picture without touching React. Drawing is `game/cascade/render/drawFrame.ts`.
 */
import React, { useMemo } from "react";
import { View } from "react-native";
import { runOnJS, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { Canvas, Group, Picture, createPicture } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../game/cascade/constants";
import { drawFrame, type BoardImages } from "../../game/cascade/render/drawFrame";
import { buildBoardStyle, type TierArt } from "../../game/cascade/render/boardStyle";
import type { CascadeLidPalette } from "../../theme/theme.cascade";

/** A throw inside the UI-thread renderer is reported once per board, on the JS thread. */
function reportDrawError(message: string): void {
  Sentry.captureMessage(`cascade.drawFrame: ${message}`, {
    level: "error",
    tags: { subsystem: "cascade.render" },
  });
}

/** The world's size: the Picture is recorded in world units and scaled by the group. */
const WORLD_BOUNDS = { width: WORLD_WIDTH, height: WORLD_HEIGHT };

export interface CascadeBoardProps {
  /** The latest published frame (`render/frame.ts`). */
  readonly frame: { readonly value: Float64Array };
  /** World-to-screen scale (`layout.ts`). */
  readonly scale: number;
  /** Active fruit set's definitions, indexed by tier: supplies bakedClipR for sprite sizing. */
  readonly fruitDefs: readonly (TierArt | undefined)[];
  /** Decoded sprites for the active fruit set, indexed by tier. null = not yet loaded. */
  readonly images: BoardImages;
  readonly lidPalette: CascadeLidPalette;
}

function CascadeBoard({ frame, scale, fruitDefs, images, lidPalette }: CascadeBoardProps) {
  const { t } = useTranslation("cascade");
  const style = useMemo(() => buildBoardStyle(fruitDefs, lidPalette), [fruitDefs, lidPalette]);
  const canvasStyle = useMemo(
    () => ({ width: WORLD_WIDTH * scale, height: WORLD_HEIGHT * scale }),
    [scale]
  );
  const transform = useMemo(() => [{ scale }], [scale]);
  const drawErrorReported = useSharedValue(false);
  const picture = useDerivedValue(() => {
    const buf = frame.value;
    return createPicture((canvas) => {
      try {
        drawFrame(canvas, buf, style, images);
      } catch (e) {
        // Whatever drew before the throw stays; report once, never take down the UI thread.
        if (!drawErrorReported.value) {
          drawErrorReported.value = true;
          runOnJS(reportDrawError)(String(e));
        }
      }
    }, WORLD_BOUNDS);
  }, [style, images]);

  // The board's role and label sit on a wrapping View: on web Skia's Canvas drops accessibility
  // props, and the board must still read as an image there (#2960, CanvasKit on web).
  return (
    <View
      style={canvasStyle}
      accessible
      accessibilityRole="image"
      accessibilityLabel={t("a11y.board")}
    >
      <Canvas style={canvasStyle}>
        <Group transform={transform}>
          <Picture picture={picture} />
        </Group>
      </Canvas>
    </View>
  );
}

export default React.memo(CascadeBoard);
