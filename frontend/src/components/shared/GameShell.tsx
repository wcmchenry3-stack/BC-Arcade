import React from "react";
import { View, ActivityIndicator, Text, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeBottomTabBarHeight } from "../../hooks/useSafeBottomTabBarHeight";
import { useTheme } from "../../theme/ThemeContext";
import { AppHeader, APP_HEADER_HEIGHT, AppHeaderProps } from "./AppHeader";

export interface GameShellProps extends Pick<
  AppHeaderProps,
  | "title"
  | "onBack"
  | "requireBack"
  | "rightSlot"
  | "onOpenScoreboard"
  | "onNewGame"
  | "onLevelSelect"
  | "onEditPlayerNames"
> {
  /** When true renders a full-screen loading spinner instead of children. */
  loading?: boolean;
  /** When non-empty renders an error banner above the game content. */
  error?: string | null;
  /** Additional styles merged onto the outer container (e.g. paddingBottom). */
  style?: StyleProp<ViewStyle>;
  children: React.ReactNode;
}

/**
 * GameShell — shared wrapper for all game screens.
 *
 * Renders AppHeader, a loading spinner, and an optional error banner so each
 * game screen only needs to provide its game-specific content as children.
 */
export function GameShell({
  title,
  onBack,
  requireBack,
  rightSlot,
  onOpenScoreboard,
  onNewGame,
  onLevelSelect,
  onEditPlayerNames,
  loading = false,
  error,
  style,
  children,
}: GameShellProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useSafeBottomTabBarHeight();

  if (loading) {
    return (
      <View style={[styles.centered, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.accent} size="large" />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: APP_HEADER_HEIGHT + insets.top,
        },
        style,
        { paddingBottom: tabBarHeight },
      ]}
    >
      <AppHeader
        title={title}
        onBack={onBack}
        requireBack={requireBack}
        rightSlot={rightSlot}
        onOpenScoreboard={onOpenScoreboard}
        onNewGame={onNewGame}
        onLevelSelect={onLevelSelect}
        onEditPlayerNames={onEditPlayerNames}
      />
      {!!error && (
        <Text
          style={[styles.errorBanner, { color: colors.error }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {error}
        </Text>
      )}
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
  container: {
    flex: 1,
  },
  errorBanner: {
    fontSize: 13,
    textAlign: "center",
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
});
