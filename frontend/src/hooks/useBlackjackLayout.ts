import { useMemo } from "react";
import { useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { APP_HEADER_HEIGHT } from "../components/shared/AppHeader";
import { useSafeBottomTabBarHeight } from "./useSafeBottomTabBarHeight";
import { calculateBlackjackLayout, type BlackjackLayout } from "../game/blackjack/layout";

export type { BlackjackLayout };

export function useBlackjackLayout(handCount = 2): BlackjackLayout {
  const { height, width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const tabBarHeight = useSafeBottomTabBarHeight();

  const availableHeight = height - insets.top - APP_HEADER_HEIGHT - tabBarHeight;

  return useMemo(
    () => calculateBlackjackLayout({ availableWidth: width, availableHeight, handCount }),
    [width, availableHeight, handCount]
  );
}
