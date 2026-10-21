/**
 * HintFrame (#3346) — the FreeCell hint overlay, drawn over one card or one run.
 *
 * Source and destination differ in shape, not only in colour (colour-blind
 * players, small cards):
 *   - `source`: a 3-px SOLID frame plus a tinted fill — "pick this up".
 *   - `destination`: a 4-px DASHED frame, no fill — "drop it here".
 * One frame spans a whole run, so a multi-card move reads as a single group.
 *
 * Static views only: no animation, no gesture-path work. `pointerEvents="none"`
 * keeps taps and drags reaching the cards underneath. Colours are theme tokens.
 */

import React from "react";
import { StyleSheet, View } from "react-native";

import { useTheme } from "../../theme/ThemeContext";

export const HINT_SOURCE_BORDER = 3;
export const HINT_DEST_BORDER = 4;
/** Opacity of the bonus-coloured fill laid over a hinted source. */
export const HINT_SOURCE_TINT_OPACITY = 0.22;

/**
 * How far each frame sits OUTSIDE the card edge. The border straddles the edge, so only
 * `border - outset` px land on the card; that must stay clear of the top-left rank/suit
 * index (drawn from x=5, y=2 on the smallest, 36-px card — see svgCardFace). The destination's
 * 2-px outset equals FreeCell's 2-px column gap, so it never reaches a neighbour's card.
 */
export const HINT_SOURCE_OUTSET = 1;
export const HINT_DEST_OUTSET = 2;

export type HintRole = "source" | "destination";

export interface HintFrameProps {
  readonly role: HintRole;
  readonly radius: number;
  /** Top of the framed area inside the parent (default 0); it runs to the parent's bottom. */
  readonly top?: number;
}

export default function HintFrame({ role, radius, top = 0 }: HintFrameProps) {
  const { colors } = useTheme();
  const isSource = role === "source";
  const outset = isSource ? HINT_SOURCE_OUTSET : HINT_DEST_OUTSET;
  return (
    <View
      pointerEvents="none"
      testID={`hint-frame-${role}`}
      style={[
        {
          position: "absolute",
          top: top - outset,
          left: -outset,
          right: -outset,
          bottom: -outset,
          borderColor: colors.bonus,
          borderWidth: isSource ? HINT_SOURCE_BORDER : HINT_DEST_BORDER,
          borderStyle: isSource ? "solid" : "dashed",
          borderRadius: radius + outset,
        },
      ]}
    >
      {isSource ? (
        <View
          testID="hint-frame-tint"
          style={[
            StyleSheet.absoluteFill,
            {
              backgroundColor: colors.bonus,
              opacity: HINT_SOURCE_TINT_OPACITY,
              borderRadius: Math.max(0, radius - (HINT_SOURCE_BORDER - HINT_SOURCE_OUTSET)),
            },
          ]}
        />
      ) : null}
    </View>
  );
}
