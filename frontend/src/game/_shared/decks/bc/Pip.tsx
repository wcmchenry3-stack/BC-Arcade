import React from "react";
import { Path } from "react-native-svg";
import { SUIT_PATHS } from "../classic/suitPaths";
import type { CanonicalSuit } from "../types";

/** Synthwave's monoline pip stroke, in card units. */
const OUTLINE_STROKE = 5;

export interface PipProps {
  readonly suit: CanonicalSuit;
  readonly cx: number;
  readonly cy: number;
  readonly size: number;
  readonly color: string;
  readonly flip?: boolean;
  /** Outline (Synthwave at 48 px and wider) instead of a solid fill. */
  readonly outline?: boolean;
}

/** A suit pip centred on (cx, cy), `size` card units tall, optionally upside down. */
export default function Pip({
  suit,
  cx,
  cy,
  size,
  color,
  flip = false,
  outline = false,
}: PipProps) {
  const s = size / 500;
  return (
    <Path
      d={SUIT_PATHS[suit]}
      fill={outline ? "none" : color}
      stroke={outline ? color : undefined}
      strokeWidth={outline ? OUTLINE_STROKE / s : undefined}
      strokeLinejoin={outline ? "round" : undefined}
      transform={`translate(${cx} ${cy}) rotate(${flip ? 180 : 0}) scale(${s}) translate(-250 -250)`}
    />
  );
}
