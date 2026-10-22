import React from "react";
import { StyleSheet, Text, View } from "react-native";
import Animated from "react-native-reanimated";
import { POWERUP_BAR_WIDTH } from "../../game/starswarm/render/hud";
import {
  STARSWARM_HULL_BLUE,
  STARSWARM_LIGHTNING,
  STARSWARM_POWERUP_TRACK,
} from "../../theme/theme.starswarm";

/** Height of the lives blocks (LivesIndicator `life`), which this indicator stacks under. */
export const LIVES_ROW_HEIGHT = 14;
/** The indicator's `top` given the lives row's `top`: directly under it, with a small gap. */
export const powerUpTopBelow = (livesTop: number) => livesTop + LIVES_ROW_HEIGHT + 4;

/**
 * #3476: the active duration power-up (SHIELD / LIGHTNING) label and draining bar. Stacked under
 * the lives row in the top-left HUD band, outside the ship's bottom movement band that the old
 * bottom-left spot overlapped. Rendered as a sibling of the main HUD (not a child) so it never
 * joins the stacking context of the full-screen phaseOverlay children.
 */
export default function PowerUpIndicator({
  kind,
  top,
  barStyle,
}: {
  kind: "shield" | "lightning";
  top: number;
  /** #2566: animated style that drains the bar on the UI thread. */
  barStyle?: React.ComponentProps<typeof Animated.View>["style"];
}) {
  const color = kind === "shield" ? STARSWARM_HULL_BLUE : STARSWARM_LIGHTNING;
  return (
    <View style={[styles.container, { top }]} pointerEvents="none" testID="starswarm-powerup">
      <Text style={[styles.label, { color }]}>{kind === "shield" ? "SHIELD" : "LIGHTNING"}</Text>
      <View style={styles.barWrap}>
        <Animated.View style={[styles.bar, { backgroundColor: color }, barStyle]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 10,
  },
  label: {
    fontSize: 8,
    fontWeight: "bold",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  barWrap: {
    width: POWERUP_BAR_WIDTH,
    height: 6,
    backgroundColor: STARSWARM_POWERUP_TRACK,
    borderRadius: 3,
    overflow: "hidden",
  },
  bar: {
    width: POWERUP_BAR_WIDTH,
    height: 6,
    borderRadius: 3,
  },
});
