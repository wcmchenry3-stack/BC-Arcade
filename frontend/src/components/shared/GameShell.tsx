import React from "react";
import { View, Text, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSafeBottomTabBarHeight } from "../../hooks/useSafeBottomTabBarHeight";
import { EmptyState } from "./EmptyState";
import { useTheme } from "../../theme/ThemeContext";
import { AppHeader, APP_HEADER_HEIGHT, AppHeaderProps } from "./AppHeader";

export interface GameShellProps extends Pick<
  AppHeaderProps,
  | "title"
  | "onBack"
  | "requireBack"
  | "backAccessibilityLabel"
  | "rightSlot"
  | "onOpenScoreboard"
  | "onOpenLeaderboard"
  | "onNewGame"
  | "onLevelSelect"
  | "onEditPlayerNames"
> {
  /**
   * When true renders a loading spinner instead of children. The header keeps
   * its title and back button so a slow load never strands the player; the ⋯
   * menu is hidden until the game is ready.
   */
  loading?: boolean;
  /** When non-empty renders an error banner above the game content. */
  error?: string | null;
  /**
   * Additional styles merged onto the outer container. A `paddingBottom` here
   * is a minimum: the container always clears the tab bar.
   */
  style?: StyleProp<ViewStyle>;
  children?: React.ReactNode;
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
  backAccessibilityLabel,
  rightSlot,
  onOpenScoreboard,
  onOpenLeaderboard,
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
  const flatPaddingBottom = StyleSheet.flatten(style)?.paddingBottom;
  const callerPaddingBottom = typeof flatPaddingBottom === "number" ? flatPaddingBottom : 0;

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: APP_HEADER_HEIGHT + insets.top,
        },
        style,
        { paddingBottom: Math.max(tabBarHeight, callerPaddingBottom) },
      ]}
    >
      {loading ? (
        <AppHeader
          title={title}
          onBack={onBack}
          requireBack={requireBack}
          backAccessibilityLabel={backAccessibilityLabel}
        />
      ) : (
        <AppHeader
          title={title}
          onBack={onBack}
          requireBack={requireBack}
          backAccessibilityLabel={backAccessibilityLabel}
          rightSlot={rightSlot}
          onOpenScoreboard={onOpenScoreboard}
          onOpenLeaderboard={onOpenLeaderboard}
          onNewGame={onNewGame}
          onLevelSelect={onLevelSelect}
          onEditPlayerNames={onEditPlayerNames}
        />
      )}
      {!!error && (
        <Text
          style={[styles.errorBanner, { color: colors.error }]}
          accessibilityRole="alert"
          accessibilityLiveRegion="assertive"
        >
          {error}
        </Text>
      )}
      {loading ? <EmptyState kind="loading" /> : children}
    </View>
  );
}

const styles = StyleSheet.create({
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
