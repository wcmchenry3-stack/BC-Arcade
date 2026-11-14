/**
 * The Cascade board (#2960): one Skia `Picture`, recorded on the UI thread from the frame the
 * screen's loop publishes to `frame` (a shared value; layout in `game/cascade/render/frame.ts`).
 *
 * It replaces the declarative `PieceRenderer` that lived in `CascadeScreen.tsx` and re-rendered
 * through React state every frame. React renders this component only when its props change (the
 * board's scale, the fruit set, the theme); a new frame re-records the Picture without touching
 * React. Drawing is `game/cascade/render/drawFrame.ts`; the pieces are the code-drawn art (#3698),
 * rasterised once per set and on-screen size (`game/cascade/art/sprites.ts`).
 */
import React, { useMemo } from "react";
import { PixelRatio, View } from "react-native";
import { runOnJS, useDerivedValue, useSharedValue } from "react-native-reanimated";
import { Canvas, Group, Picture, createPicture } from "@shopify/react-native-skia";
import { useTranslation } from "react-i18next";
import * as Sentry from "@sentry/react-native";
import { WORLD_HEIGHT, WORLD_WIDTH } from "../../game/cascade/constants";
import { drawFrame } from "../../game/cascade/render/drawFrame";
import { buildBoardStyle } from "../../game/cascade/render/boardStyle";
import { pieceSprites } from "../../game/cascade/art/sprites";
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
  /** The active fruit set's id: which pieces are drawn. */
  readonly setId: string;
  readonly lidPalette: CascadeLidPalette;
}

function CascadeBoard({ frame, scale, setId, lidPalette }: CascadeBoardProps) {
  const { t } = useTranslation("cascade");
  const style = useMemo(() => buildBoardStyle(lidPalette), [lidPalette]);
  // One bitmap pixel per screen pixel at each tier's ladder radius (never scaled up).
  const pxPerUnit = scale * PixelRatio.get();
  const sprites = useMemo(() => pieceSprites(setId, pxPerUnit), [setId, pxPerUnit]);
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
        drawFrame(canvas, buf, style, sprites);
      } catch (e) {
        // Whatever drew before the throw stays; report once, never take down the UI thread.
        if (!drawErrorReported.value) {
          drawErrorReported.value = true;
          runOnJS(reportDrawError)(String(e));
        }
      }
    }, WORLD_BOUNDS);
  }, [style, sprites]);

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
