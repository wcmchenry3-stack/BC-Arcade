import React from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useTheme } from "../../theme/ThemeContext";
import { APP_HEADER_HEIGHT } from "./AppHeader";

export interface ScreenFrameProps {
  /**
   * Keep content above the home indicator: `paddingBottom` is
   * `Math.max(insets.bottom, 16)`. Defaults to true; false leaves the bottom
   * to the screen (Settings scrolls to the edge).
   */
  padBottom?: boolean;
  /** The screen's `AppHeader` and its content. */
  children?: React.ReactNode;
}

/**
 * The frame of a non-game screen (#2976): a full-height themed container that
 * clears the floating `AppHeader` (`APP_HEADER_HEIGHT + insets.top`) and,
 * unless `padBottom` is false, the bottom safe area. The screen renders its
 * own `AppHeader` inside. Game screens use `GameShell` instead, which also
 * clears the tab bar and adds the side gutter.
 */
export function ScreenFrame({ padBottom = true, children }: ScreenFrameProps) {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          paddingTop: APP_HEADER_HEIGHT + insets.top,
        },
        padBottom && { paddingBottom: Math.max(insets.bottom, 16) },
      ]}
    >
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
});
