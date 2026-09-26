/**
 * The app's bottom tabs (#2634) — pure data, no React.
 *
 * `App.tsx` registers `MainTabs()` from this list and `BottomTabBar` takes each
 * tab's icon and label from it, so `mainTabs.test.tsx` can pin the tab bar
 * without booting the app. Every build (store, dev, test, pre-launch) has
 * the same three tabs: none depends on which games are visible.
 *
 * Leaderboards open from each game (its result card and ⋯ menu, #2633), not
 * from a tab; the Star Swarm-only "Ranks" tab was retired in #2634.
 */
import type React from "react";
import type MaterialIcons from "@expo/vector-icons/MaterialIcons";

export interface MainTab {
  name: string;
  icon: React.ComponentProps<typeof MaterialIcons>["name"];
  /** Key in the `common` namespace. */
  labelKey: string;
}

export const MAIN_TABS = [
  { name: "Lobby", icon: "sports-esports", labelKey: "nav.lobby" },
  { name: "Profile", icon: "person", labelKey: "nav.profile" },
  { name: "Settings", icon: "settings", labelKey: "nav.settings" },
] as const satisfies readonly MainTab[];

export type MainTabName = (typeof MAIN_TABS)[number]["name"];
