/**
 * #2963: the native canvas's background and scrolling starfield, under the scene Picture.
 *
 * The Pictures are recorded once per starfield layout (`recordStarfield` — the layout is fixed
 * for a canvas size, so in practice once per mount) and each depth layer is slid by its own
 * offset, derived on the UI thread from one shared scroll clock that the game loop advances. So
 * the starfield costs no display-list ops, no JS allocation per star and no Picture re-record per
 * frame. Each layer is drawn twice, the second copy a canvas-height above the first, so stars
 * that scroll off the bottom come back in at the top.
 */
import React, { useMemo } from "react";
import { useDerivedValue } from "react-native-reanimated";
import type { SharedValue } from "react-native-reanimated";
import { Group, Picture } from "@shopify/react-native-skia";
import type { SkPicture } from "@shopify/react-native-skia";
import { layerTransform, recordStarfield } from "../../game/starswarm/render/starfieldPictures";
import type { StarfieldState } from "../../game/starswarm/starfield";

interface Props {
  /** The fixed star layout (its `elapsedMs` is ignored — `clock` scrolls it). */
  readonly layout: StarfieldState;
  /** Starfield scroll clock, ms (`StarfieldState.elapsedMs`), written by the game loop. */
  readonly clock: SharedValue<number>;
}

function StarLayer({
  picture,
  speed,
  height,
  clock,
}: {
  picture: SkPicture;
  speed: number;
  height: number;
  clock: SharedValue<number>;
}) {
  const transform = useDerivedValue(() => layerTransform(clock.value, speed, height));
  return (
    <Group transform={transform}>
      <Picture picture={picture} />
      <Group transform={[{ translateY: -height }]}>
        <Picture picture={picture} />
      </Group>
    </Group>
  );
}

export default function StarfieldLayers({ layout, clock }: Props) {
  const pictures = useMemo(() => recordStarfield(layout), [layout]);
  return (
    <>
      <Picture picture={pictures.backdrop} />
      {pictures.layers.map((l) => (
        <StarLayer
          key={l.speed}
          picture={l.picture}
          speed={l.speed}
          height={layout.height}
          clock={clock}
        />
      ))}
    </>
  );
}
