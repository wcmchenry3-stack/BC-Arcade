import React from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { useTheme } from "../../theme/ThemeContext";
import { PillButton } from "./PillButton";

export interface EmptyStateProps {
  kind: "loading" | "empty" | "error";
  /** Required for `empty` and `error`; optional caption under the spinner. */
  message?: string;
  /** Shows a retry pill under an `error` message. */
  retry?: { label: string; onPress: () => void };
  /**
   * `fill` (default) centers in the remaining space, for a whole-screen
   * state. `inline` is padded text, for a FlatList's ListEmptyComponent.
   */
  layout?: "fill" | "inline";
  testID?: string;
}

/** Loading spinner, empty-list message, or error with retry (#2604). */
export function EmptyState({ kind, message, retry, layout = "fill", testID }: EmptyStateProps) {
  const { colors } = useTheme();

  const color = kind === "error" ? colors.error : kind === "empty" ? colors.textMuted : colors.text;

  return (
    <View style={layout === "fill" ? styles.fill : styles.inline} testID={testID}>
      {kind === "loading" && (
        <ActivityIndicator color={colors.accent} size="large" accessibilityLabel="Loading" />
      )}
      {message !== undefined && (
        <Text
          style={[styles.message, { color }, kind === "loading" && styles.loadingCaption]}
          accessibilityRole={kind === "error" ? "alert" : undefined}
        >
          {message}
        </Text>
      )}
      {kind === "error" && retry && (
        <PillButton label={retry.label} onPress={retry.onPress} style={styles.retry} />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 24,
  },
  inline: {
    alignItems: "center",
    paddingVertical: 48,
    paddingHorizontal: 24,
  },
  message: {
    fontSize: 14,
    textAlign: "center",
  },
  loadingCaption: {
    marginTop: 12,
  },
  retry: {
    marginTop: 12,
  },
});
