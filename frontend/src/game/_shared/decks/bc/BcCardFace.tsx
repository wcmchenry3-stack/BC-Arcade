/**
 * BcCardFace (#3577) — the one SVG face behind the Arcade, Parlor and Synthwave decks.
 *
 * Ported from the approved HTML/SVG mockup: a 250 x 350 card box scaled by the SVG viewBox, a
 * big index in the corner (repeated rotated 180 degrees), pips laid out A-10, double-headed
 * J/Q/K art and one back design per deck. Arcade and Parlor take face, ink, red-suit and edge
 * colours from the theme props like Classic; Synthwave keeps its own dark face in both themes,
 * with a glow and solid pips below 48 px wide.
 */
import React from "react";
import {
  Circle,
  Defs,
  FeGaussianBlur,
  FeMerge,
  FeMergeNode,
  Filter,
  G,
  Rect,
  Svg,
  Text as SvgText,
} from "react-native-svg";
import { BC_DECK_ART } from "../../../../theme/theme.cards";
import { rankLabel, RED_SUITS } from "../cardId";
import type { CardFaceProps } from "../types";
import Back, { DECK_RADIUS } from "./Back";
import Edge from "./Edge";
import Court from "./Court";
import { BC_FONTS } from "./fonts";
import {
  acePipSize,
  CARD_H,
  CARD_W,
  CORNER,
  CORNER_SUIT_SIZE,
  SCRIM_RADIUS_PX,
  OUTLINE_MIN_WIDTH,
  PIP_SIZE,
  pipSpots,
  type BcDeckId,
} from "./geometry";
import Pip from "./Pip";

/** An id fragment that is safe inside `url(#...)`: useId() yields characters like ":" or "«". */
function useSvgUid(): string {
  return `bc${React.useId().replace(/[^A-Za-z0-9_-]/g, "")}`;
}

/** Hidden from assistive tech: PlayingCard's wrapper carries the card's label. */
const A11Y_HIDDEN = {
  accessible: false,
  importantForAccessibility: "no-hide-descendants",
} as const;

export interface BcCardFaceProps extends CardFaceProps {
  readonly deck: BcDeckId;
}

interface Look {
  readonly face: string;
  readonly edge: string;
  readonly black: string;
  readonly red: string;
  readonly font: string;
}

function lookFor(deck: BcDeckId, p: CardFaceProps): Look {
  if (deck === "synthwave") {
    const s = BC_DECK_ART.synthwave;
    return { face: s.face, edge: p.border, black: s.black, red: s.red, font: BC_FONTS.space };
  }
  return {
    face: p.cardBg,
    edge: p.border,
    black: p.textColor,
    red: p.redSuitColor,
    font: deck === "parlor" ? BC_FONTS.manrope : BC_FONTS.space,
  };
}

interface PipsProps {
  readonly deck: BcDeckId;
  readonly suit: CardFaceProps["suit"];
  readonly rank: number;
  readonly color: string;
  readonly outline: boolean;
}

/** The ace (one large pip, ringed in Arcade) or the pips of a 2-10. */
function Pips({ deck, suit, rank, color, outline }: PipsProps) {
  if (rank === 1) {
    return (
      <>
        <Pip
          suit={suit}
          cx={CARD_W / 2}
          cy={CARD_H / 2}
          size={acePipSize(deck, suit)}
          color={color}
          outline={outline}
        />
        {deck === "arcade" ? (
          <Circle
            cx={CARD_W / 2}
            cy={CARD_H / 2}
            r={72}
            fill="none"
            stroke={color}
            strokeOpacity={0.25}
            strokeWidth={3}
          />
        ) : null}
      </>
    );
  }
  return (
    <>
      {pipSpots(rank).map((s, i) => (
        <Pip
          key={i}
          suit={suit}
          cx={s.cx}
          cy={s.cy}
          size={PIP_SIZE}
          flip={s.flip}
          color={color}
          outline={outline}
        />
      ))}
    </>
  );
}

/** Court palette [main, accent, gold] and panel fill for a deck and suit colour. */
function courtLook(deck: BcDeckId, red: boolean): { pal: ReadonlyArray<string>; panel?: string } {
  if (deck === "arcade") {
    const a = BC_DECK_ART.arcade;
    return red
      ? { pal: a.courtRed, panel: a.panelRed }
      : { pal: a.courtBlack, panel: a.panelBlack };
  }
  if (deck === "parlor") {
    const p = BC_DECK_ART.parlor;
    return { pal: red ? p.courtRed : p.courtBlack, panel: p.panel };
  }
  const s = BC_DECK_ART.synthwave;
  const ink = red ? s.red : s.black;
  return { pal: [ink, ink, ink] };
}

export default function BcCardFace(props: BcCardFaceProps) {
  const { deck, suit, rank, width, height, faceDown } = props;
  const radius = DECK_RADIUS[deck];
  const uid = useSvgUid();
  const glowId = `${uid}-glow`;
  const svgProps = {
    ...A11Y_HIDDEN,
    width,
    height,
    viewBox: `0 0 ${CARD_W} ${CARD_H}`,
    preserveAspectRatio: "none",
  } as const;

  const look = lookFor(deck, props);

  if (faceDown) {
    // 6 px on screen at any width, like PlayingCard's scrim and hint frame.
    const outerRadius = (SCRIM_RADIUS_PX * CARD_W) / width;
    return (
      <Svg {...svgProps}>
        <Back deck={deck} fonts={BC_FONTS} uid={uid} outerRadius={outerRadius} />
        <Edge radius={outerRadius} stroke={look.edge} />
      </Svg>
    );
  }

  const color = RED_SUITS.has(suit) ? look.red : look.black;
  const synth = deck === "synthwave";
  const outline = synth && width >= OUTLINE_MIN_WIDTH;
  // Glow only where it can be seen and is cheap: court art and the ace pip at 48 px and wider.
  const glow = outline && (rank === 1 || rank >= 11);
  const label = rankLabel(rank);
  const c = label.length > 1 ? CORNER.two : CORNER.one;
  const pivot = `translate(${CARD_W / 2} ${CARD_H / 2}) rotate(180) translate(${-CARD_W / 2} ${-CARD_H / 2})`;

  const cornerText = (
    <SvgText
      x={c.x}
      y={CORNER.textY}
      textAnchor="middle"
      fontFamily={look.font}
      fontSize={c.fontSize}
      fill={color}
    >
      {label}
    </SvgText>
  );
  const cornerPip = (
    <Pip suit={suit} cx={CORNER.suitX} cy={CORNER.suitY} size={CORNER_SUIT_SIZE} color={color} />
  );

  let centre: React.ReactNode;
  if (rank >= 11) {
    const red = RED_SUITS.has(suit);
    const { pal, panel } = courtLook(deck, red);
    centre = (
      <Court
        deck={deck}
        suit={suit}
        rank={rank}
        palette={pal}
        panel={panel}
        ink={synth ? undefined : look.black}
        outline={outline}
        uid={uid}
      />
    );
  } else {
    centre = <Pips deck={deck} suit={suit} rank={rank} color={color} outline={outline} />;
  }

  const art = (
    <>
      {glow ? <G filter={`url(#${glowId})`}>{centre}</G> : centre}
      {cornerPip}
      <G transform={pivot}>{cornerPip}</G>
    </>
  );

  return (
    <Svg {...svgProps}>
      {glow ? (
        <Defs>
          <Filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <FeGaussianBlur stdDeviation="4" result="b" />
            <FeMerge>
              <FeMergeNode in="b" />
              <FeMergeNode in="SourceGraphic" />
            </FeMerge>
          </Filter>
        </Defs>
      ) : null}
      <Rect width={CARD_W} height={CARD_H} rx={radius} fill={look.face} />
      <Edge radius={radius} stroke={look.edge} />
      {synth ? (
        <Rect
          x={8}
          y={8}
          width={CARD_W - 16}
          height={CARD_H - 16}
          rx={radius - 5}
          fill="none"
          stroke={color}
          strokeOpacity={0.45}
          strokeWidth={2.5}
        />
      ) : null}
      {deck === "parlor" ? (
        <Rect
          x={7}
          y={7}
          width={CARD_W - 14}
          height={CARD_H - 14}
          rx={radius - 4}
          fill="none"
          stroke={color}
          strokeOpacity={0.25}
          strokeWidth={2}
        />
      ) : null}
      {art}
      {cornerText}
      <G transform={pivot}>{cornerText}</G>
    </Svg>
  );
}
