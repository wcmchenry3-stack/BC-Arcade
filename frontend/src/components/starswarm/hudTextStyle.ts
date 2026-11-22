import type { TextStyle } from "react-native";
import type { HudTextStyle } from "../../game/starswarm/render/hudStyle";

/**
 * #3598: a shared HUD text style as a React Native text style. The glow is a text shadow with no
 * offset, drawn by the text renderer itself: no per-frame Skia blur. Built once, in StyleSheets.
 * No fontWeight: each brand family name is already one weight.
 */
export function hudTextStyle(s: HudTextStyle): TextStyle {
  const base: TextStyle = {
    fontFamily: s.family,
    fontSize: s.size,
    lineHeight: s.lineHeight,
    color: s.color,
    letterSpacing: s.letterSpacing,
  };
  if (s.glow === null) return base;
  return {
    ...base,
    textShadowColor: s.glow,
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: s.glowRadius,
  };
}
