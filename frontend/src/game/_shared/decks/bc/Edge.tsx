import React from "react";
import { Rect } from "react-native-svg";
import { CARD_H, CARD_W, EDGE_INSET, EDGE_WIDTH } from "./geometry";

/** The card's outer edge, inset so the whole stroke is inside the viewBox. */
export default function Edge({
  radius,
  stroke,
}: {
  readonly radius: number;
  readonly stroke: string;
}) {
  return (
    <Rect
      x={EDGE_INSET}
      y={EDGE_INSET}
      width={CARD_W - EDGE_WIDTH}
      height={CARD_H - EDGE_WIDTH}
      rx={Math.max(radius - EDGE_INSET, 0)}
      fill="none"
      stroke={stroke}
      strokeWidth={EDGE_WIDTH}
    />
  );
}
