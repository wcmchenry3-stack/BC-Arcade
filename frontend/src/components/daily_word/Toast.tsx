import React from "react";
import { StyleSheet, Text, View } from "react-native";

import { useTheme } from "../../theme/ThemeContext";
import { typography } from "../../theme/typography";

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------

export function Toast({ message }: { readonly message: string | null }) {
  const { colors } = useTheme();
  if (!message) return null;
  return (
    <View
      style={[toastStyles.container, { backgroundColor: colors.text }]}
      accessibilityRole="alert"
      accessibilityLiveRegion="assertive"
    >
      <Text style={[toastStyles.text, { color: colors.background }]}>{message}</Text>
    </View>
  );
}

const toastStyles = StyleSheet.create({
  container: {
    position: "absolute",
    top: 12,
    alignSelf: "center",
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 8,
    zIndex: 100,
    maxWidth: 280,
  },
  text: {
    fontFamily: typography.body,
    fontSize: 13,
    fontWeight: "700",
    textAlign: "center",
  },
});
