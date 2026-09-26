import { createContext, useContext, useEffect, useState } from "react";
import { NavigationContext } from "@react-navigation/native";

// Outside a navigator (and in tests that mock @react-navigation/native
// without NavigationContext) there is no screen to leave: always focused.
const NoNavigation = createContext<undefined>(undefined);
const ScreenNavigation: typeof NavigationContext = NavigationContext ?? NoNavigation;

/**
 * Whether the screen this component is rendered in is the focused one.
 *
 * Unlike `useIsFocused`, it doesn't throw outside a navigator: it answers
 * `true` there. `GameResultModal` uses it to hide its native `Modal` while
 * another screen (the leaderboard, #2633) is pushed on top of the game: a
 * `Modal` is its own window on iOS and Android and would otherwise cover the
 * pushed screen.
 */
export function useIsScreenFocused(): boolean {
  const navigation = useContext(ScreenNavigation);
  const [focused, setFocused] = useState(() => navigation?.isFocused?.() ?? true);

  useEffect(() => {
    if (!navigation?.addListener) return;
    setFocused(navigation.isFocused?.() ?? true);
    const offFocus = navigation.addListener("focus", () => setFocused(true));
    const offBlur = navigation.addListener("blur", () => setFocused(false));
    return () => {
      offFocus?.();
      offBlur?.();
    };
  }, [navigation]);

  return focused;
}
