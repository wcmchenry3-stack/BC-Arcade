/**
 * One Cascade piece as a small icon (#3698): the same code-drawn art the board draws, upright and
 * fitted (overhangs included) into a `size` x `size` square, recorded once as a vector Picture per
 * set, tier and size (`game/cascade/art/sprites.ts`), so it is sharp at any pixel ratio. Used by
 * the next-piece preview, the theme selector and the dev panel. Decorative: the caller labels it.
 */
import React, { useMemo } from "react";
import { View } from "react-native";
import { Canvas, Picture } from "@shopify/react-native-skia";
import type { TierSetId } from "../../game/cascade/tiers";
import { piecePicture } from "../../game/cascade/art/sprites";

interface Props {
  /** The piece: its set and tier. */
  fruit: { readonly set: TierSetId; readonly tier: number };
  size: number;
}

export default function FruitGlyph({ fruit, size }: Props) {
  const picture = useMemo(
    () => piecePicture(fruit.set, fruit.tier, size),
    [fruit.set, fruit.tier, size]
  );
  const box = useMemo(() => ({ width: size, height: size }), [size]);
  return (
    <View style={box} importantForAccessibility="no" accessible={false}>
      {picture && (
        <Canvas style={box}>
          <Picture picture={picture} />
        </Canvas>
      )}
    </View>
  );
}
