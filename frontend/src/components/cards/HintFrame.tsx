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
import { StyleSheet, View, type ViewStyle } from "react-native";

import { useTheme } from "../../theme/ThemeContext";

export const HINT_SOURCE_BORDER = 3;
export const HINT_DEST_BORDER = 4;
/** Opacity of the bonus-coloured fill laid over a hinted source. */
export const HINT_SOURCE_TINT_OPACITY = 0.22;

export type HintRole = "source" | "destination";

export interface HintFrameProps {
  readonly role: HintRole;
  readonly radius: number;
  /** Positioning inside the parent; defaults to filling it. */
  readonly style?: ViewStyle;
}

export default function HintFrame({ role, radius, style }: HintFrameProps) {
  const { colors } = useTheme();
  const isSource = role === "source";
  return (
    <View
      pointerEvents="none"
      testID={`hint-frame-${role}`}
      style={[
        StyleSheet.absoluteFill,
        {
          borderColor: colors.bonus,
          borderWidth: isSource ? HINT_SOURCE_BORDER : HINT_DEST_BORDER,
          borderStyle: isSource ? "solid" : "dashed",
          borderRadius: radius,
        },
        style,
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
              borderRadius: Math.max(0, radius - HINT_SOURCE_BORDER),
            },
          ]}
        />
      ) : null}
    </View>
  );
}
