import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useNavigation } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../theme/ThemeContext";
import { typography } from "../theme/typography";
import { AppHeader, APP_HEADER_HEIGHT } from "../components/shared/AppHeader";

export default function LockedGameScreen() {
  const navigation = useNavigation();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.screen, { backgroundColor: colors.background }]}>
      <AppHeader title="Locked" />
      <View
        style={[
          styles.content,
          { paddingTop: APP_HEADER_HEIGHT + insets.top + 32, paddingBottom: insets.bottom + 24 },
        ]}
      >
        <Text style={styles.lockEmoji}>🔒</Text>
        <Text style={[styles.heading, { color: colors.text }]}>Premium Game</Text>
        <Text style={[styles.body, { color: colors.textMuted }]}>
          This game requires a BC Arcade subscription.
        </Text>
        <Pressable
          style={[styles.backBtn, { backgroundColor: colors.surfaceHigh }]}
          onPress={() => navigation.goBack()}
          accessibilityRole="button"
          accessibilityLabel="Go back to lobby"
        >
          <Text style={[styles.backBtnText, { color: colors.text }]}>Back to Lobby</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 32,
    gap: 16,
  },
  lockEmoji: {
    fontSize: 64,
  },
  heading: {
    fontFamily: typography.heading,
    fontSize: 24,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  body: {
    fontFamily: typography.body,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  backBtn: {
    marginTop: 8,
    paddingVertical: 12,
    paddingHorizontal: 32,
    borderRadius: 20,
  },
  backBtnText: {
    fontFamily: typography.label,
    fontSize: 13,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
});
