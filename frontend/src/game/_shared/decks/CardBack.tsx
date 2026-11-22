/**
 * The face-down card (#3740), drawn from `cardBackShapes`. One component for every SVG deck:
 * the deck passes its palette and corner radius; the shapes are cached on (design, size, radius,
 * colours) and the component is memoised, so a re-render of an unchanged card draws nothing new.
 */
import React, { memo } from "react";
import { Path, Rect, Svg } from "react-native-svg";
import { cardBackShapes, type CardBackDesign, type CardBackPalette } from "./cardBackShapes";

export interface CardBackProps {
  readonly design?: CardBackDesign;
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly rim: string;
  readonly field: string;
  readonly line: string;
  readonly accent: string;
  readonly edge: string;
}

function CardBack({
  design = "lattice",
  width,
  height,
  radius,
  rim,
  field,
  line,
  accent,
  edge,
}: CardBackProps) {
  const palette: CardBackPalette = { rim, field, line, accent, edge };
  const shapes = cardBackShapes(design, width, height, radius, palette);
  return (
    <Svg width={width} height={height}>
      {shapes.map((s, i) =>
        s.el === "rect" ? (
          <Rect
            key={i}
            x={s.x}
            y={s.y}
            width={s.width}
            height={s.height}
            rx={s.rx}
            fill={s.fill ?? "none"}
            stroke={s.stroke}
            strokeWidth={s.strokeWidth}
          />
        ) : (
          <Path
            key={i}
            d={s.d}
            fill={s.fill ?? "none"}
            stroke={s.stroke}
            strokeWidth={s.strokeWidth}
            opacity={s.opacity}
          />
        )
      )}
    </Svg>
  );
}

export default memo(CardBack);
