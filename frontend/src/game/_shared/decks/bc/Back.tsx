/**
 * Card backs for the Arcade (BC monogram in rings), Parlor (navy lattice) and Synthwave
 * (sunset over a synth grid) decks (#3577). One design per deck, in the 250 x 350 box.
 */
import React from "react";
import {
  ClipPath,
  Circle,
  Defs,
  Ellipse,
  G,
  LinearGradient,
  Path,
  Rect,
  Stop,
  Text as SvgText,
} from "react-native-svg";
import { BC_DECK_ART } from "../../../../theme/theme.cards";
import { CARD_H, CARD_W, type BcDeckId } from "./geometry";
import type { BcFonts } from "./fonts";

const W = CARD_W;
const H = CARD_H;
const CX = W / 2;
const CY = H / 2;

/** Corner radius of each deck's design (face and the inner art of the back), in card units. */
export const DECK_RADIUS: Record<BcDeckId, number> = { arcade: 14, parlor: 12, synthwave: 16 };

const PARLOR_LATTICE = (() => {
  let d = "";
  for (let i = -10; i < 20; i++) {
    d += `M${i * 22} 0 L${i * 22 + H} ${H} M${i * 22} ${H} L${i * 22 + H} 0 `;
  }
  return d.trim();
})();

const SYNTH_HORIZON = H * 0.52;
const SYNTH_GRID = (() => {
  let d = "";
  for (let i = 0; i <= 10; i++) d += `M${CX} ${SYNTH_HORIZON} L${-150 + i * 55} ${H} `;
  for (let i = 0; i < 7; i++) {
    const y = SYNTH_HORIZON + H * 0.48 * Math.pow(i / 6, 1.8);
    d += `M0 ${y} H${W} `;
  }
  return d.trim();
})();

interface BackProps {
  readonly fonts: BcFonts;
  /** Per-instance id prefix for clip paths and gradients. */
  readonly uid: string;
  /** Outer corner radius in card units (6 px on screen, like PlayingCard's scrim). */
  readonly outerRadius: number;
}

function ArcadeBack({ fonts, outerRadius }: BackProps) {
  const a = BC_DECK_ART.arcade;
  const r = DECK_RADIUS.arcade;
  return (
    <>
      <Rect width={W} height={H} rx={outerRadius} fill={a.backFill} />
      <Rect
        x={12}
        y={12}
        width={W - 24}
        height={H - 24}
        rx={r - 5}
        fill="none"
        stroke={a.backCyan}
        strokeWidth={3}
      />
      {[0, 1, 2, 3, 4, 5].map((i) => (
        <Rect
          key={i}
          x={30 + i * 14}
          y={30 + i * 14}
          width={W - 60 - i * 28}
          height={H - 60 - i * 28}
          rx={Math.max(4, r - 8 - i * 2)}
          fill="none"
          stroke={i % 2 ? a.backViolet : a.backCyan}
          strokeOpacity={0.55 - i * 0.07}
          strokeWidth={2}
        />
      ))}
      <Circle cx={CX} cy={CY} r={40} fill={a.backCore} stroke={a.backCyan} strokeWidth={3} />
      <SvgText
        x={CX}
        y={CY + 14}
        textAnchor="middle"
        fontFamily={fonts.space}
        fontSize={40}
        fill={a.backCyan}
      >
        BC
      </SvgText>
    </>
  );
}

function ParlorBack({ fonts, uid, outerRadius }: BackProps) {
  const p = BC_DECK_ART.parlor;
  const r = DECK_RADIUS.parlor;
  return (
    <>
      <Defs>
        <ClipPath id={`${uid}-parlor-clip`}>
          <Rect x={16} y={16} width={W - 32} height={H - 32} rx={6} />
        </ClipPath>
      </Defs>
      <Rect width={W} height={H} rx={outerRadius} fill={p.backPaper} />
      <Rect x={10} y={10} width={W - 20} height={H - 20} rx={r - 3} fill={p.backNavy} />
      <G clipPath={`url(#${uid}-parlor-clip)`}>
        <Path d={PARLOR_LATTICE} stroke={p.backGold} strokeOpacity={0.45} strokeWidth={2} />
      </G>
      <Rect
        x={16}
        y={16}
        width={W - 32}
        height={H - 32}
        rx={6}
        fill="none"
        stroke={p.backGold}
        strokeWidth={3}
      />
      <Ellipse
        cx={CX}
        cy={CY}
        rx={54}
        ry={66}
        fill={p.backNavy}
        stroke={p.backGold}
        strokeWidth={4}
      />
      <SvgText
        x={CX}
        y={CY + 13}
        textAnchor="middle"
        fontFamily={fonts.manrope}
        fontSize={38}
        fill={p.backGold}
      >
        BC
      </SvgText>
    </>
  );
}

function SynthwaveBack({ fonts, uid, outerRadius }: BackProps) {
  const s = BC_DECK_ART.synthwave;
  const r = DECK_RADIUS.synthwave;
  const horizon = SYNTH_HORIZON;
  return (
    <>
      <Defs>
        <LinearGradient id={`${uid}-sky`} x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0" stopColor={s.backNight} />
          <Stop offset="0.52" stopColor={s.backSky} />
          <Stop offset="0.52" stopColor={s.backNight} />
        </LinearGradient>
        <ClipPath id={`${uid}-synth-clip`}>
          <Rect x={10} y={10} width={W - 20} height={H - 20} rx={r - 4} />
        </ClipPath>
      </Defs>
      <Rect width={W} height={H} rx={outerRadius} fill={s.backNight} />
      <G clipPath={`url(#${uid}-synth-clip)`}>
        <Rect width={W} height={H} fill={`url(#${uid}-sky)`} />
        <Circle cx={CX} cy={horizon} r={58} fill={s.backSun} opacity={0.85} />
        <Rect x={0} y={horizon} width={W} height={H} fill={s.backNight} />
        <Path d={SYNTH_GRID} stroke={s.backGrid} strokeOpacity={0.7} strokeWidth={2} />
      </G>
      <Rect
        x={10}
        y={10}
        width={W - 20}
        height={H - 20}
        rx={r - 4}
        fill="none"
        stroke={s.backGrid}
        strokeWidth={3}
      />
      <SvgText
        x={CX}
        y={H * 0.3}
        textAnchor="middle"
        fontFamily={fonts.space}
        fontSize={44}
        fill={s.backGrid}
      >
        BC
      </SvgText>
    </>
  );
}

export default function Back({ deck, ...rest }: BackProps & { readonly deck: BcDeckId }) {
  if (deck === "arcade") return <ArcadeBack {...rest} />;
  if (deck === "parlor") return <ParlorBack {...rest} />;
  return <SynthwaveBack {...rest} />;
}
