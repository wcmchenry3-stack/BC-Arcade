import { useBottomTabBarHeight } from "@react-navigation/bottom-tabs";

// useBottomTabBarHeight throws when rendered outside a BottomTabNavigator (e.g.
// modals, deep-link stacks, tests). This wrapper catches that and returns 0 so
// callers degrade gracefully instead of crashing.
export function useSafeBottomTabBarHeight(fallback = 0): number {
  try {
    return useBottomTabBarHeight();
  } catch {
    return fallback;
  }
}
