/**
 * Shared dev-panel card picker (#3576): choose an ordered list of cards (a rank
 * then a suit adds one), reorder or remove them, clear the list, or fill it from
 * a preset. Game-agnostic: a card is `{ rank, suit }` strings, so Hearts,
 * Solitaire and FreeCell panels can reuse it. What the cards mean (a deal order,
 * a stock) belongs to the game's panel. Built from the DevPanelShell controls.
 */
import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { DevActionButton, DevRow, DevSection } from "./DevPanelShell";

export interface DevPickerCard {
  readonly rank: string;
  readonly suit: string;
}

export interface DevCardPreset {
  readonly label: string;
  readonly cards: readonly DevPickerCard[];
}

export interface DevCardPickerProps {
  readonly cards: readonly DevPickerCard[];
  readonly onChange: (cards: readonly DevPickerCard[]) => void;
  readonly presets?: readonly DevCardPreset[];
  /** Defaults to A, 2..10, J, Q, K. */
  readonly ranks?: readonly string[];
  /** Defaults to ♠ ♥ ♦ ♣. */
  readonly suits?: readonly string[];
}

const DEFAULT_RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"];
const DEFAULT_SUITS = ["♠", "♥", "♦", "♣"];

export function DevCardPicker({
  cards,
  onChange,
  presets,
  ranks = DEFAULT_RANKS,
  suits = DEFAULT_SUITS,
}: DevCardPickerProps) {
  const { colors } = useTheme();
  const [pendingRank, setPendingRank] = useState<string | null>(null);

  const addCard = (suit: string) => {
    if (pendingRank === null) return;
    onChange([...cards, { rank: pendingRank, suit }]);
  };
  const remove = (i: number) => onChange(cards.filter((_, idx) => idx !== i));
  const move = (i: number, by: -1 | 1) => {
    const j = i + by;
    if (j < 0 || j >= cards.length) return;
    const next = [...cards];
    const a = next[i]!;
    next[i] = next[j]!;
    next[j] = a;
    onChange(next);
  };

  return (
    <>
      {presets !== undefined && presets.length > 0 && (
        <DevSection title="Presets">
          <View style={styles.wrap}>
            {presets.map((p) => (
              <DevActionButton
                key={p.label}
                label={p.label}
                onPress={() => onChange(p.cards.map((c) => ({ rank: c.rank, suit: c.suit })))}
                testID={`dev-card-preset-${p.label}`}
              />
            ))}
          </View>
        </DevSection>
      )}

      <DevSection title="Add card">
        <Text style={[styles.hint, { color: colors.textMuted }]}>
          {pendingRank === null ? "Pick a rank, then a suit" : `Rank ${pendingRank}: pick a suit`}
        </Text>
        <View style={styles.wrap}>
          {ranks.map((r) => (
            <DevActionButton
              key={r}
              label={pendingRank === r ? `[${r}]` : r}
              onPress={() => setPendingRank(r)}
              variant={pendingRank === r ? "primary" : "default"}
              accessibilityLabel={`Rank ${r}`}
              testID={`dev-card-rank-${r}`}
            />
          ))}
        </View>
        <View style={styles.wrap}>
          {suits.map((s) => (
            <DevActionButton
              key={s}
              label={s}
              onPress={() => addCard(s)}
              accessibilityLabel={`Suit ${s}`}
              testID={`dev-card-suit-${s}`}
            />
          ))}
        </View>
      </DevSection>

      <DevSection title={`Picked (${cards.length})`}>
        {cards.length === 0 && (
          <Text style={[styles.hint, { color: colors.textMuted }]}>No cards picked</Text>
        )}
        {cards.map((c, i) => (
          <DevRow key={`${i}-${c.rank}${c.suit}`} label={`${i + 1}. ${c.rank}${c.suit}`}>
            <View style={styles.wrap}>
              <DevActionButton
                label="↑"
                onPress={() => move(i, -1)}
                accessibilityLabel={`Move ${c.rank}${c.suit} up`}
                testID={`dev-card-up-${i}`}
              />
              <DevActionButton
                label="↓"
                onPress={() => move(i, 1)}
                accessibilityLabel={`Move ${c.rank}${c.suit} down`}
                testID={`dev-card-down-${i}`}
              />
              <DevActionButton
                label="✕"
                onPress={() => remove(i)}
                accessibilityLabel={`Remove ${c.rank}${c.suit}`}
                testID={`dev-card-remove-${i}`}
              />
            </View>
          </DevRow>
        ))}
        <DevActionButton label="Clear" onPress={() => onChange([])} testID="dev-card-clear" />
      </DevSection>
    </>
  );
}

const styles = StyleSheet.create({
  wrap: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  hint: { fontSize: 12 },
});
