/**
 * Test-build-only "safe run" button (#4079), for `e2e/maestro/flows/starswarm/edge-drag.yaml`.
 *
 * The edge-drag flow must not depend on surviving real play: on a slow CI emulator one swipe
 * can take 14 s and the run died before the asserts (the result card, a Modal, then hides the
 * `ship-x` line from Maestro on Android). One tap here starts a dev run (the dev panel's New
 * Game: off the boards, `devRun`) with infinite lives and enemy missiles and asteroids off, so
 * nothing can end it. The dev panel offers the same switches, but driving it from Maestro
 * meant several taps on a run that keeps playing behind the sidebar, and scrolling the
 * sidebar to its New Game button, where a scroll gesture over the canvas is a drag.
 *
 * StarSwarmScreen mounts it only in builds with `EXPO_PUBLIC_TEST_HOOKS=1` and the dev tools
 * on (`DEV_TOOLS`, which the dev options need), never in a store build. Absolutely positioned
 * in the canvas's top-right corner, above the drag zone, so it changes no layout; no text
 * (nothing to translate).
 */
import React from "react";
import { Pressable, StyleSheet } from "react-native";

import { useTheme } from "../../theme/ThemeContext";

export const TEST_SAFE_RUN_TEST_ID = "starswarm-test-safe-run";

/** Platform minimum touch target. */
const SIZE = 44;

export default function TestSafeRunControl({ onPress }: { readonly onPress: () => void }) {
  const { colors } = useTheme();
  return (
    <Pressable
      testID={TEST_SAFE_RUN_TEST_ID}
      onPress={onPress}
      accessibilityRole="button"
      style={[styles.button, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    right: 0,
    top: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: 8,
    borderWidth: 1,
  },
});
