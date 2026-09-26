import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { useSafeBottomTabBarHeight } from "./useSafeBottomTabBarHeight";
import {
  calculateBlackjackLayout,
  type BlackjackLayout,
} from "../game/blackjack/layout";

export type { BlackjackLayout };

export function useBlackjackLayout(): BlackjackLayout {
  const { width, height } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useSafeBottomTabBarHeight();

  const availableWidth = width;
  const availableHeight = height - insets.top - APP_HEADER_HEIGHT - tabBarHeight;

  return useMemo(
    () => calculateBlackjackLayout({ availableWidth, availableHeight }),
    [availableWidth, availableHeight],
  );
}
