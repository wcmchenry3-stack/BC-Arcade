/**
 * Test-build-only "deal draw-3" button (#3532). Maestro can't open the
 * draw-mode picker in a test build (the screen deals draw-1 straight away),
 * so `e2e/maestro/flows/solitaire/drag-draw3.yaml` taps this instead. See
 * game/solitaire/testHooks.ts.
 *
 * Absolutely positioned in the board's bottom-right corner, so it changes no
 * layout: every coordinate the drag flows derive stays valid. It has no text
 * (nothing to translate) and only exists when `isTestDealControlShown` is
 * true, never in a store build.
 */
import React from "react";
import { Platform, Pressable, StyleSheet } from "react-native";

import { useTheme } from "../../theme/ThemeContext";
import { isTestDealControlShown, TEST_DEAL_DRAW3_TEST_ID } from "../../game/solitaire/testHooks";

/** Platform minimum touch target. */
const SIZE = 44;

export default function TestDealControl({ onDealDraw3 }: { readonly onDealDraw3: () => void }) {
  const { colors } = useTheme();
  if (!isTestDealControlShown(Platform.OS)) return null;
  return (
    <Pressable
      testID={TEST_DEAL_DRAW3_TEST_ID}
      onPress={onDealDraw3}
      accessibilityRole="button"
      style={[styles.button, { backgroundColor: colors.surfaceAlt, borderColor: colors.border }]}
    />
  );
}

const styles = StyleSheet.create({
  button: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: SIZE,
    height: SIZE,
    borderRadius: 8,
    borderWidth: 1,
  },
});
