/**
 * Cascade test controls (#3719): a hidden row of buttons for the Maestro demo flows.
 *
 * Maestro's `runScript` runs on the host, so it cannot call the `__cascade_*` hooks that live in
 * the app's JS. These buttons run the same set-ups from a tap. They show only when
 * `EXPO_PUBLIC_TEST_HOOKS=1`: the screen does not render this component otherwise, and a store
 * bundle does not contain the screen at all (`metro/storeBundle.js` swaps CascadeScreen for
 * an empty stub, #2830), so nothing of this reaches a store build.
 *
 * Hidden from players in the sense that a test build is not a player build: the row is small and
 * faint, under the board. Each button has a testID Maestro taps. The labels are not translated
 * (they are for test drivers, never a player).
 *
 * | testID                     | does                                                    |
 * | -------------------------- | ------------------------------------------------------- |
 * | `cascade-test-chain`       | chain pile + queue of cherries (3 merges from 1 tap)   |
 * | `cascade-test-near-lid`    | pile over the lid, clock ring draining                 |
 * | `cascade-test-fill-bin`    | bin filled above the lid; the lid ends the game        |
 * | `cascade-test-win`         | two capstones about to touch: the win (#3904)          |
 * | `cascade-test-game-over`   | forces game over (an extra; the loss demo uses fill)   |
 *
 * The win's result card is #3699: today the win stops play (no more drops) and shows nothing.
 */
import React from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../theme/ThemeContext";
import { areTestHooksEnabled } from "../../game/_shared/envFlags";

export interface CascadeTestControlsProps {
  onChain: () => void;
  onNearLid: () => void;
  onFillBin: () => void;
  onWin: () => void;
  onForceGameOver: () => void;
}

export default function CascadeTestControls({
  onChain,
  onNearLid,
  onFillBin,
  onWin,
  onForceGameOver,
}: CascadeTestControlsProps) {
  const { colors } = useTheme();
  if (!areTestHooksEnabled()) return null;
  return (
    <View style={styles.row} testID="cascade-test-controls">
      <TestButton
        id="cascade-test-chain"
        label="chain"
        onPress={onChain}
        color={colors.textMuted}
      />
      <TestButton
        id="cascade-test-near-lid"
        label="lid"
        onPress={onNearLid}
        color={colors.textMuted}
      />
      <TestButton
        id="cascade-test-fill-bin"
        label="fill"
        onPress={onFillBin}
        color={colors.textMuted}
      />
      <TestButton id="cascade-test-win" label="win" onPress={onWin} color={colors.textMuted} />
      <TestButton
        id="cascade-test-game-over"
        label="end"
        onPress={onForceGameOver}
        color={colors.textMuted}
      />
    </View>
  );
}

function TestButton({
  id,
  label,
  onPress,
  color,
}: {
  id: string;
  label: string;
  onPress: () => void;
  color: string;
}) {
  return (
    <Pressable
      testID={id}
      accessibilityRole="button"
      accessibilityLabel={id}
      onPress={onPress}
      style={[styles.button, { borderColor: color }]}
    >
      <Text style={[styles.label, { color }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    opacity: 0.35,
  },
  // 44 pt wide and 32 pt tall: small, but a reliable Maestro tap target.
  button: {
    minWidth: 44,
    height: 32,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: 6,
  },
  label: { fontSize: 11 },
});
