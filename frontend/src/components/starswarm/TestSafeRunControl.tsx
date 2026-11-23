/**
 * Test-build-only "safe run" button (#4079), for `e2e/maestro/flows/starswarm/edge-drag.yaml`.
 *
 * The edge-drag flow must not depend on surviving real play: on the slow CI emulator a normal
 * run is shot down 20–30 s after Start, and the result card (a Modal, which on Android hides
 * everything under it from Maestro) then covers the `ship-x` line. Switching a live run to safe
 * mode races that death, so this button sits in the difficulty picker, beside Start, and the
 * flow taps it instead of Start: the run it starts (the dev panel's New Game, off the boards)
 * has infinite lives and enemy missiles and asteroids off from its first frame.
 *
 * StarSwarmScreen renders it only in builds with `EXPO_PUBLIC_TEST_HOOKS=1` and the dev tools
 * on (`DEV_TOOLS`, which the dev options need), never in a store build. It has no text
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
    width: SIZE,
    height: SIZE,
    borderRadius: 8,
    borderWidth: 1,
  },
});
