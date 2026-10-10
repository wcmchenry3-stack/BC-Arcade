/**
 * SvgCardFace (#2983) — the one SVG skeleton behind the Classic and Neon decks.
 *
 * Both decks draw the same card: a rounded face with an inset border, the rank
 * and a small suit glyph in the top-left corner, a centre pip (or a framed J/Q/K
 * letter) and the corner repeated rotated 180°; face-down, a diamond-grid back.
 * A deck is a palette, a corner radius, its glyph set and, optionally, a glow
 * filter — see `classic/` and `neon/`.
 */
import React from "react";
import {
  Defs,
  FeGaussianBlur,
  FeMerge,
  FeMergeNode,
  Filter,
  G,
  Path,
  Rect,
  Svg,
  Text as SvgText,
} from "react-native-svg";
import { rankLabel, RED_SUITS } from "./cardId";
import type { CanonicalSuit, CardFaceProps } from "./types";

/** Every colour a face draws, resolved by the deck (from theme props or its own palette). */
export interface SvgCardPalette {
  /** Face-up fill. */
  readonly face: string;
  /** Face-down fill. */
  readonly back: string;
  /** The back's inset border and the frame around a J/Q/K letter. */
  readonly border: string;
  /** The face-up card's inset border. */
  readonly faceBorder: string;
  /** Stroke and opacity of the back's diamond grid. */
  readonly backGrid: string;
  readonly backGridOpacity: number;
  /** Spades/clubs and hearts/diamonds: corner glyphs, the pip and the J/Q/K letter. */
  readonly blackSuit: string;
  readonly redSuit: string;
  /** Fixed colour for the corner rank; omitted, the rank takes its suit colour. */
  readonly rank?: string;
}

/**
 * A deck's suit glyphs (owner decision on #2983: each deck keeps its own set):
 * the centre pip paths, drawn in a 500-unit box, and the small corner glyph.
 */
export interface SvgCardGlyphs {
  readonly pipPaths: Readonly<Record<CanonicalSuit, string>>;
  readonly cornerGlyph: (suit: CanonicalSuit) => string;
}

export interface SvgCardFaceProps extends Pick<
  CardFaceProps,
  "suit" | "rank" | "width" | "height" | "faceDown"
> {
  readonly palette: SvgCardPalette;
  readonly radius: number;
  readonly glyphs: SvgCardGlyphs;
  /** SVG filter id: defines a blur-halo glow and applies it to the centre pip/letter. */
  readonly glowFilter?: string;
}

const FACE_LETTERS: Record<number, string> = { 11: "J", 12: "Q", 13: "K" };

/** Blur halo merged under the sharp source graphic. */
function GlowDefs({ id }: { readonly id: string }) {
  return (
    <Defs>
      <Filter id={id} x="-30%" y="-30%" width="160%" height="160%">
        <FeGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur" />
        <FeMerge>
          <FeMergeNode in="blur" />
          <FeMergeNode in="SourceGraphic" />
        </FeMerge>
      </Filter>
    </Defs>
  );
}

/** The card's rounded fill plus its 1-px inset border. */
function Frame({
  width,
  height,
  radius,
  fill,
  stroke,
}: {
  readonly width: number;
  readonly height: number;
  readonly radius: number;
  readonly fill: string;
  readonly stroke: string;
}) {
  return (
    <>
      <Rect x={0} y={0} width={width} height={height} rx={radius} fill={fill} />
      <Rect
        x={1}
        y={1}
        width={width - 2}
        height={height - 2}
        rx={radius - 1}
        stroke={stroke}
        strokeWidth={1}
        fill="none"
      />
    </>
  );
}

export default function SvgCardFace({
  suit,
  rank,
  width,
  height,
  faceDown,
  palette,
  radius,
  glyphs,
  glowFilter,
}: SvgCardFaceProps) {
  if (faceDown) {
    return (
      <Svg width={width} height={height}>
        <Frame
          width={width}
          height={height}
          radius={radius}
          fill={palette.back}
          stroke={palette.border}
        />
        {/* Diamond-grid back pattern */}
        <G opacity={palette.backGridOpacity}>
          {Array.from({ length: 8 }, (_, i) => (
            <Path
              key={i}
              d={`M ${(i - 2) * 14} 0 L ${(i + 2) * 14} ${height}`}
              stroke={palette.backGrid}
              strokeWidth={1}
            />
          ))}
          {Array.from({ length: 8 }, (_, i) => (
            <Path
              key={`h${i}`}
              d={`M 0 ${(i - 2) * 14} L ${width} ${(i + 2) * 14}`}
              stroke={palette.backGrid}
              strokeWidth={1}
            />
          ))}
        </G>
      </Svg>
    );
  }

  const suitColor = RED_SUITS.has(suit) ? palette.redSuit : palette.blackSuit;
  const rankColor = palette.rank ?? suitColor;
  const glow = glowFilter ? { filter: `url(#${glowFilter})` } : undefined;
  const rl = rankLabel(rank);
  const glyph = glyphs.cornerGlyph(suit);
  const faceLabel = FACE_LETTERS[rank];
  const cornerFontSize = Math.max(10, Math.round(width * 0.24));
  const smallSuitSize = Math.max(8, Math.round(width * 0.18));
  const cx = width / 2;
  const cy = height / 2;

  // Centre content scales with card size
  const suitViewSize = Math.round(Math.min(width, height) * 0.52);
  const suitX = cx - suitViewSize / 2;
  const suitY = cy - suitViewSize / 2;

  const corner = (
    <>
      <SvgText
        x={5}
        y={cornerFontSize + 2}
        fontSize={cornerFontSize}
        fontWeight="700"
        fill={rankColor}
      >
        {rl}
      </SvgText>
      <SvgText
        x={5}
        y={cornerFontSize + smallSuitSize + 4}
        fontSize={smallSuitSize}
        fill={suitColor}
      >
        {glyph}
      </SvgText>
    </>
  );

  return (
    <Svg width={width} height={height}>
      {glowFilter ? <GlowDefs id={glowFilter} /> : null}

      <Frame
        width={width}
        height={height}
        radius={radius}
        fill={palette.face}
        stroke={palette.faceBorder}
      />

      {/* Top-left corner: rank and small suit */}
      {corner}

      {/* Centre: suit pip or framed face letter */}
      {faceLabel ? (
        <>
          <Rect
            x={6}
            y={height * 0.22}
            width={width - 12}
            height={height * 0.56}
            rx={4}
            stroke={palette.border}
            strokeWidth={0.75}
            fill="none"
          />
          <SvgText
            x={cx}
            y={cy + suitViewSize * 0.28}
            fontSize={suitViewSize * 0.72}
            fontWeight="700"
            fill={suitColor}
            textAnchor="middle"
            {...glow}
          >
            {faceLabel}
          </SvgText>
        </>
      ) : (
        <G transform={`translate(${suitX}, ${suitY}) scale(${suitViewSize / 500})`}>
          <Path d={glyphs.pipPaths[suit]} fill={suitColor} {...glow} />
        </G>
      )}

      {/* Bottom-right corner (rotated 180°) */}
      <G rotation={180} origin={`${cx}, ${cy}`}>
        {corner}
      </G>
    </Svg>
  );
}
