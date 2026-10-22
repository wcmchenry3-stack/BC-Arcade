import React from "react";
import { StyleSheet, View } from "react-native";
import { useTranslation } from "react-i18next";
import { STARSWARM_ACCENT } from "../../theme/theme.starswarm";

/**
 * #2150: remaining lives, one block each. Sits in the top-left HUD band (under the score), clear
 * of the ship's movement band along the bottom, which the old bottom-left spot overlapped.
 * Rendered as a sibling of the main HUD (not a child) so it never joins the stacking context of
 * the full-screen phaseOverlay children.
 */
export default function LivesIndicator({ lives }: { lives: number }) {
  const { t } = useTranslation("starswarm");
  return (
    <View
      style={styles.container}
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
  // Directly under the hudTop score row (paddingTop 8 + one 12pt text line).
  container: {
    position: "absolute",
    top: 28,
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
