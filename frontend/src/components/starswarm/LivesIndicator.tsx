import React from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { STARSWARM_ACCENT } from "../../theme/theme.starswarm";

/** Used until the HUD score row has been measured: paddingTop 8 + one 12pt line + a small gap. */
export const LIVES_TOP_FALLBACK = 28;
/** The lives row's `top` given the measured bottom edge of the HUD score row. */
export const livesTopBelow = (hudTopBottom: number) => hudTopBottom + 4;

/**
 * #2150: remaining lives, one block each. Sits in the top-left HUD band (under the score), clear
 * of the ship's movement band along the bottom, which the old bottom-left spot overlapped.
 * Rendered as a sibling of the main HUD (not a child) so it never joins the stacking context of
 * the full-screen phaseOverlay children.
 */
export default function LivesIndicator({
  lives,
  top = LIVES_TOP_FALLBACK,
}: {
  lives: number;
  top?: number;
}) {
  const { t } = useTranslation("starswarm");
  return (
    <View
      style={[styles.container, { top }]}
      pointerEvents="none"
      accessible
      accessibilityLabel={t("hud.livesValue", { lives })}
      testID="starswarm-lives"
    >
      {Array.from({ length: lives }, (_, i) => (
        <View key={i} style={styles.life} testID="starswarm-life" />
      ))}
    </View>
  );
}

export const styles = StyleSheet.create({
  // `top` is passed in (measured from the score row); LIVES_TOP_FALLBACK until then.
  container: {
    position: "absolute",
    left: 10,
    flexDirection: "row",
    gap: 6,
  },
  life: {
    width: 10,
    height: 14,
    backgroundColor: STARSWARM_ACCENT,
  },
});
