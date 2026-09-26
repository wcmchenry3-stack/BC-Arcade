/**
 * mainTabs (#2634) — App.tsx registers `MainTabs()` from `MAIN_TABS`, so this is
 * the guard that every build has the same three tabs. The Star Swarm-only
 * Ranks tab is retired: leaderboards open from each game, never from a tab.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import BottomTabBar from "../../components/shared/BottomTabBar";
import {
  HIDDEN_GAMES,
  __forceStoreBuildForTests,
  isGameVisible,
} from "../../entitlements/gameVisibility";
import { ThemeProvider } from "../../theme/ThemeContext";
import { MAIN_TABS } from "../mainTabs";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

/** The tab bar as the navigator hands it the registered tabs. */
function tabBarProps(): BottomTabBarProps {
  const routes = MAIN_TABS.map(({ name }) => ({
    key: `${name}-key`,
    name,
  })) as unknown as BottomTabBarProps["state"]["routes"];
  return {
    state: { routes, index: 0 } as BottomTabBarProps["state"],
    navigation: { navigate: jest.fn() } as unknown as BottomTabBarProps["navigation"],
    descriptors: {} as BottomTabBarProps["descriptors"],
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

describe.each([
  ["a dev build, with every game visible", false],
  ["a store build, with the premium games hidden", true],
])("main tabs in %s", (_build, storeBuild) => {
  beforeEach(() => __forceStoreBuildForTests(storeBuild));
  afterEach(() => __forceStoreBuildForTests(false));

  it("are exactly Lobby, Profile and Settings", () => {
    for (const slug of HIDDEN_GAMES) expect(isGameVisible(slug)).toBe(!storeBuild);
    expect(MAIN_TABS.map((tab) => tab.name)).toEqual(["Lobby", "Profile", "Settings"]);
  });

  it("render as three labelled tabs", async () => {
    await render(
      <ThemeProvider>
        <BottomTabBar {...tabBarProps()} />
      </ThemeProvider>
    );
    const tabs = screen.getAllByRole("tab");
    expect(tabs.map((tab) => tab.props.accessibilityLabel)).toEqual([
      "Lobby",
      "Profile",
      "Settings",
    ]);
    expect(tabs.map((tab) => tab.props.testID)).toEqual([
      "tab-lobby",
      "tab-profile",
      "tab-settings",
    ]);
  });
});
