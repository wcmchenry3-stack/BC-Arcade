/**
 * J/Q/K art for the Arcade, Parlor and Synthwave decks (#3577): one half-figure in a 150 x 118
 * box, drawn twice (mirrored about the card centre) inside a framed panel. Arcade is flat and
 * geometric, Parlor traditional, Synthwave a single-line icon (crown, tiara, cap).
 */
import React from "react";
import { Circle, ClipPath, Defs, G, Path, Rect } from "react-native-svg";
import { BC_DECK_ART } from "../../../../theme/theme.cards";
import type { CanonicalSuit } from "../types";
import { CARD_H, CARD_W, COURT, type BcDeckId } from "./geometry";
import Pip from "./Pip";

type Palette = ReadonlyArray<string>;

interface FigureProps {
  readonly deck: BcDeckId;
  readonly rank: number;
  readonly suit: CanonicalSuit;
  readonly palette: Palette;
  readonly ink: string;
}

/** Synthwave: one monoline emblem per rank, with the suit outlined beneath it. */
function IconFigure({
  rank,
  suit,
  palette,
  outline,
}: Omit<FigureProps, "deck" | "ink"> & { readonly outline: boolean }) {
  const [main, acc] = palette as [string, string, string];
  const sw = {
    fill: "none",
    strokeWidth: 6,
    strokeLinejoin: "round" as const,
    strokeLinecap: "round" as const,
    stroke: acc,
  };
  return (
    <>
      {rank === 13 ? (
        <>
          <Path d="M38 82 L44 40 L60 60 L75 32 L90 60 L106 40 L112 82 Z" {...sw} />
          <Path d="M40 92 H110" {...sw} />
        </>
      ) : null}
      {rank === 12 ? (
        <>
          <Path d="M40 84 C46 58 58 48 75 48 C92 48 104 58 110 84 Z" {...sw} />
          <Circle cx={75} cy={38} r={7} {...sw} />
          <Circle cx={52} cy={50} r={5} {...sw} />
          <Circle cx={98} cy={50} r={5} {...sw} />
        </>
      ) : null}
      {rank === 11 ? (
        <>
          <Path d="M38 84 C38 56 56 44 76 44 C96 44 108 58 110 84 Z" {...sw} />
          <Path d="M92 46 C108 26 124 22 132 24 C122 32 112 40 100 52" {...sw} />
        </>
      ) : null}
      <Pip suit={suit} cx={75} cy={102} size={20} color={main} outline={outline} />
    </>
  );
}

/** Arcade and Parlor: a half-figure with head, hair or crown, shoulders, collar and suit mark. */
function BustFigure({ deck, rank, suit, palette, ink }: FigureProps) {
  const [main, acc, gold] = palette as [string, string, string];
  const skin = BC_DECK_ART.skin;
  const trad = deck === "parlor";
  const stroke = { stroke: ink, strokeWidth: 2 };

  let hat: React.ReactNode;
  let hair: React.ReactNode = null;
  let beard: React.ReactNode = null;
  let hand: React.ReactNode;
  if (rank === 13) {
    hat = (
      <>
        <Path d="M54 34 L58 12 L66 24 L75 8 L84 24 L92 12 L96 34 Z" fill={gold} {...stroke} />
        <Rect x={54} y={32} width={42} height={7} fill={acc} {...stroke} />
      </>
    );
    beard = (
      <Path
        d="M60 58 C62 76 70 82 75 82 C80 82 88 76 90 58 C84 64 66 64 60 58 Z"
        fill={trad ? BC_DECK_ART.beard : gold}
        {...stroke}
      />
    );
    hand = (
      <>
        <Path d="M124 118 L124 44" stroke={gold} strokeWidth={5} />
        <Circle cx={124} cy={40} r={7} fill={gold} {...stroke} />
      </>
    );
  } else if (rank === 12) {
    hat = (
      <Path
        d="M58 34 C64 22 86 22 92 34 L88 30 L82 36 L75 26 L68 36 L62 30 Z"
        fill={gold}
        {...stroke}
      />
    );
    hair = (
      <Path
        d="M54 40 C50 64 50 84 44 96 L58 96 C58 80 60 62 62 48 Z M96 40 C100 64 100 84 106 96 L92 96 C92 80 90 62 88 48 Z"
        fill={acc}
        {...stroke}
      />
    );
    hand = (
      <>
        <Circle cx={28} cy={70} r={9} fill={main} {...stroke} />
        <Path d="M28 79 L32 112" stroke={ink} strokeWidth={3} />
      </>
    );
  } else {
    hat = (
      <>
        <Path d="M52 38 C54 22 70 18 80 20 C92 22 100 30 100 38 Z" fill={acc} {...stroke} />
        <Path d="M96 26 C110 10 124 8 132 10 C122 18 112 26 100 34" fill={gold} {...stroke} />
      </>
    );
    hair = (
      <Path
        d="M56 40 C54 52 56 60 58 64 L62 46 Z M94 40 C96 52 94 60 92 64 L88 46 Z"
        fill={gold}
        {...stroke}
      />
    );
    hand = (
      <>
        <Path d="M22 118 L30 54" stroke={ink} strokeWidth={4} />
        <Path d="M24 54 L36 54 L30 40 Z" fill={gold} {...stroke} />
      </>
    );
  }

  const robe = trad ? (
    <>
      <Path
        d="M22 118 C26 98 40 88 58 86 L92 86 C110 88 124 98 128 118 Z"
        fill={main}
        {...stroke}
      />
      <Path d="M58 86 L75 118 L92 86" fill={acc} {...stroke} />
      <Path d="M30 104 H50 M100 104 H120 M34 112 H50 M100 112 H116" stroke={gold} strokeWidth={3} />
    </>
  ) : (
    <>
      <Path
        d="M24 118 L36 90 Q40 84 50 84 L100 84 Q110 84 114 90 L126 118 Z"
        fill={main}
        {...stroke}
      />
      <Path d="M50 84 L75 100 L100 84" fill={acc} {...stroke} />
      <Rect x={24} y={112} width={102} height={6} fill={gold} />
    </>
  );

  return (
    <>
      {robe}
      {hair}
      <Rect x={68} y={66} width={14} height={20} fill={skin} {...stroke} />
      <Circle cx={75} cy={52} r={18} fill={skin} {...stroke} />
      <Circle cx={69} cy={50} r={2} fill={ink} />
      <Circle cx={81} cy={50} r={2} fill={ink} />
      {beard}
      {hat}
      {hand}
      <G opacity={0.95}>
        <Pip suit={suit} cx={75} cy={104} size={18} color={BC_DECK_ART.chestMark} />
      </G>
    </>
  );
}

export interface CourtProps {
  readonly deck: BcDeckId;
  readonly suit: CanonicalSuit;
  readonly rank: number;
  readonly palette: Palette;
  /** Panel fill (Arcade and Parlor; Synthwave has none). */
  readonly panel?: string;
  readonly ink: string;
  /** Synthwave's suit mark: outline at 48 px and wider, solid below. */
  readonly outline: boolean;
  /** Per-instance id prefix for the clip path. */
  readonly uid: string;
}

/** The framed, double-headed court panel. */
export default function Court({ deck, suit, rank, palette, panel, ink, outline, uid }: CourtProps) {
  const { x: fx, y: fy, w: fw, h: fh, halfW, halfH } = COURT;
  const clipId = `${uid}-court-clip`;
  const k = fh / 2 / halfH;
  const half = (
    <G
      transform={`translate(${fx + fw / 2 - (halfW / 2) * k} ${fy + fh / 2 - halfH * k}) scale(${k})`}
    >
      {deck === "synthwave" ? (
        <IconFigure rank={rank} suit={suit} palette={palette} outline={outline} />
      ) : (
        <BustFigure deck={deck} rank={rank} suit={suit} palette={palette} ink={ink} />
      )}
    </G>
  );
  const frame =
    deck === "synthwave" ? (
      <Rect
        x={fx}
        y={fy}
        width={fw}
        height={fh}
        rx={14}
        fill="none"
        stroke={palette[1]}
        strokeWidth={3}
      />
    ) : (
      <Rect
        x={fx}
        y={fy}
        width={fw}
        height={fh}
        rx={deck === "arcade" ? 10 : 4}
        fill={panel}
        stroke={palette[0]}
        strokeWidth={3}
      />
    );
  return (
    <>
      <Defs>
        <ClipPath id={clipId}>
          <Rect x={fx} y={fy} width={fw} height={fh} rx={10} />
        </ClipPath>
      </Defs>
      {frame}
      <G clipPath={`url(#${clipId})`}>
        {half}
        <G
          transform={`translate(${CARD_W / 2} ${CARD_H / 2}) rotate(180) translate(${-CARD_W / 2} ${-CARD_H / 2})`}
        >
          {half}
        </G>
      </G>
      {deck === "synthwave" ? null : (
        <Path
          d={`M${fx} ${fy + fh / 2} H${fx + fw}`}
          stroke={palette[0]}
          strokeWidth={2}
          strokeDasharray={deck === "arcade" ? "6 5" : undefined}
        />
      )}
    </>
  );
}
