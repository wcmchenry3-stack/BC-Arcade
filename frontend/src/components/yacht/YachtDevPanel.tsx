/**
 * Yacht's developer panel (moved out of GameScreen in #2978): picks the five
 * dice the next human roll lands on. Dev builds only.
 */
import React, { useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { DEV_SURFACE_SUBTLE } from "../../theme/theme.constants";
import { DevActionButton, DevPanelShell, DevSection, DevStepper } from "../dev/DevPanelShell";

type Dice = [number, number, number, number, number];

const PRESETS: readonly (readonly [string, Dice])[] = [
  ["Yacht", [3, 3, 3, 3, 3]],
  ["Full House", [2, 2, 2, 5, 5]],
  ["Sm. Straight", [1, 2, 3, 4, 6]],
  ["Lg. Straight", [1, 2, 3, 4, 5]],
  ["All 1s", [1, 1, 1, 1, 1]],
  ["All 6s", [6, 6, 6, 6, 6]],
];

export interface YachtDevPanelProps {
  readonly enabled: boolean;
  readonly open: boolean;
  readonly onOpen: () => void;
  readonly onClose: () => void;
  /** The dice to force on the next human roll (held dice are respected). */
  readonly onApply: (dice: number[]) => void;
}

export default function YachtDevPanel(props: YachtDevPanelProps) {
  if (!props.enabled) return null;
  return <YachtDevPanelBody {...props} />;
}

function YachtDevPanelBody({ open, onOpen, onClose, onApply }: YachtDevPanelProps) {
  const { colors } = useTheme();
  const [dice, setDice] = useState<Dice>([3, 3, 3, 3, 3]);

  const step = (i: number, delta: 1 | -1) =>
    setDice((d) => {
      const next = [...d] as Dice;
      next[i] = delta > 0 ? Math.min(6, d[i]! + 1) : Math.max(1, d[i]! - 1);
      return next;
    });

  return (
    <DevPanelShell
      enabled
      open={open}
      onOpen={onOpen}
      onClose={onClose}
      title="Yacht Dev Panel"
      buttonPosition="bottom-right"
    >
      <DevSection title="Dice Override" color={colors.textMuted}>
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          Applied on next roll. Held dice are respected.
        </Text>

        <View style={styles.diceRow}>
          {dice.map((val, i) => (
            <DevStepper
              key={i}
              layout="column"
              value={val}
              onIncrement={() => step(i, 1)}
              onDecrement={() => step(i, -1)}
              incrementLabel={`Increase die ${i + 1}`}
              decrementLabel={`Decrease die ${i + 1}`}
            />
          ))}
        </View>
      </DevSection>

      <DevSection title="Presets" color={colors.textMuted}>
        {PRESETS.map(([label, preset]) => (
          <Pressable key={label} style={styles.presetBtn} onPress={() => setDice(preset)}>
            <Text style={styles.presetText}>
              {label} [{preset.join(",")}]
            </Text>
          </Pressable>
        ))}
      </DevSection>

      <DevActionButton
        label="Apply on next roll"
        variant="primary"
        onPress={() => {
          onApply([...dice]);
          onClose();
        }}
      />

      <DevActionButton label="Close" onPress={onClose} />
    </DevPanelShell>
  );
}

const styles = StyleSheet.create({
  hint: {
    fontSize: 11,
    textAlign: "center",
  },
  diceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 4,
  },
  presetBtn: {
    backgroundColor: DEV_SURFACE_SUBTLE,
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    alignItems: "center",
  },
  presetText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "600",
  },
});
