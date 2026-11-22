import React, { useCallback } from "react";
import { View, Text, StyleSheet, StyleProp, ViewStyle } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useNavigation } from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import type { GameType } from "../../api/vocab";
import type { HomeStackParamList } from "../../types/navigation";
import { hasScorecard } from "../../navigation/scorecards";
import { useSafeBottomTabBarHeight } from "../../hooks/useSafeBottomTabBarHeight";
import { EmptyState } from "./EmptyState";
import { useTheme } from "../../theme/ThemeContext";
import { AppHeader, APP_HEADER_HEIGHT, AppHeaderProps } from "./AppHeader";

/** The side gutter a game screen keeps beyond the safe-area insets (#2976). */
export const GAME_SHELL_GUTTER = 12;

/** The gap under a game's content when the screen sets none (#3624). */
export const GAME_SHELL_BOTTOM_GAP = 8;

export interface GameShellProps extends Pick<
  AppHeaderProps,
  | "title"
  | "requireBack"
  | "backAccessibilityLabel"
  | "rightSlot"
  | "onOpenLeaderboard"
  | "onNewGame"
  | "onLevelSelect"
  | "onEditPlayerNames"
  | "menuToggle"
  | "menuInfo"
> {
  /**
   * The game this screen plays (#2635). Its ⋯ menu gets a "Stats" item that
   * opens the shared `GameStats` screen for it and, for a game with a live
   * view (`SCORECARD_GAMES`, #2636), a "Scorecard" item. `null` for a screen
   * that is not one game's play screen (a scorecard, a run history, a dev
   * tool): neither item. Required, so a new game screen can't leave it out.
   */
  gameType: GameType | null;
  /**
   * The header's back button. Defaults to returning to the lobby
   * (`navigation.popToTop()`, #2976); pass a handler for any other back
   * (Hearts and Sort go back one screen), or `null` for no back button.
   */
  onBack?: (() => void) | null;
  /**
   * The minimum side padding (#2976): the container's `paddingLeft` /
   * `paddingRight` are `Math.max(inset, gutter)`. Defaults to
   * `GAME_SHELL_GUTTER` (12); `0` pads by the insets alone, and `null`
   * applies no side padding (a screen that lays out its own edges). A
   * `paddingLeft` / `paddingRight` in `style` still wins.
   */
  gutter?: number | null;
  /**
   * When true renders a loading spinner instead of children. The header keeps
   * its title and back button so a slow load never strands the player; the ⋯
   * menu is hidden until the game is ready.
   */
  loading?: boolean;
  /** When non-empty renders an error banner above the game content. */
  error?: string | null;
  /**
   * Additional styles merged onto the outer container. A `paddingBottom` here is the gap
   * under the content (#3624): inside the tab navigator the tab bar sits in flow below the
   * screen and clears the bottom inset itself, so it is the whole bottom padding; outside it
   * (no tab bar) the container also clears the bottom safe-area inset.
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
  gameType,
  title,
  onBack,
  requireBack,
  backAccessibilityLabel,
  rightSlot,
  onOpenLeaderboard,
  onNewGame,
  onLevelSelect,
  onEditPlayerNames,
  menuToggle,
  menuInfo,
  loading = false,
  error,
  gutter = GAME_SHELL_GUTTER,
  style,
  children,
}: GameShellProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Non-zero only inside the tab navigator (react-navigation's estimate: our custom bar does
  // not report its height), so it only tells whether there is a tab bar.
  const inTabBar = useSafeBottomTabBarHeight() > 0;
  const flatPaddingBottom = StyleSheet.flatten(style)?.paddingBottom;
  // A screen that sets no bottom gap gets GAME_SHELL_BOTTOM_GAP, so nothing sits flush on the tab bar.
  const callerPaddingBottom =
    typeof flatPaddingBottom === "number" ? flatPaddingBottom : GAME_SHELL_BOTTOM_GAP;
  const navigation = useNavigation<NativeStackNavigationProp<HomeStackParamList>>();
  const popToTop = useCallback(() => navigation.popToTop(), [navigation]);
  const handleBack = onBack === null ? undefined : (onBack ?? popToTop);
  const openStats = useCallback(() => {
    if (gameType) navigation.navigate("GameStats", { gameType });
  }, [navigation, gameType]);
  const openScorecard = useCallback(() => {
    if (hasScorecard(gameType)) navigation.navigate("Scorecard", { gameKey: gameType });
  }, [navigation, gameType]);

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: APP_HEADER_HEIGHT + insets.top,
        },
        gutter != null && {
          paddingLeft: Math.max(insets.left, gutter),
          paddingRight: Math.max(insets.right, gutter),
        },
        style,
        // The tab bar is a sibling below the screen, not over it (#3624): padding by its
        // height too left an empty band above it on every game screen.
        {
          paddingBottom: inTabBar
            ? callerPaddingBottom
            : Math.max(insets.bottom, callerPaddingBottom),
        },
      ]}
    >
      {loading ? (
        <AppHeader
          title={title}
          onBack={handleBack}
          requireBack={requireBack}
          backAccessibilityLabel={backAccessibilityLabel}
        />
      ) : (
        <AppHeader
          title={title}
          onBack={handleBack}
          requireBack={requireBack}
          backAccessibilityLabel={backAccessibilityLabel}
          rightSlot={rightSlot}
          onOpenScorecard={hasScorecard(gameType) ? openScorecard : undefined}
          onOpenStats={gameType ? openStats : undefined}
          onOpenLeaderboard={onOpenLeaderboard}
          onNewGame={onNewGame}
          onLevelSelect={onLevelSelect}
          onEditPlayerNames={onEditPlayerNames}
          menuToggle={menuToggle}
          menuInfo={menuInfo}
        />
      )}
      {!!error && (
        <Text
          style={[styles.errorBanner, { color: colors.errorText }]}
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
