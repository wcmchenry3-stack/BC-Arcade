/**
 * mainTabs (#2634) — the tab registry and the tab bar it drives. The Star
 * Swarm-only Ranks tab is retired: leaderboards open from each game, never
 * from a tab.
 *
 * What this guards: `MAIN_TABS` is exactly Lobby, Profile and Settings, and
 * the tab bar renders them labelled. `MAIN_TABS` is a constant with no build
 * dependency, so the same holds in every build. What it can't guard:
 * `App.tsx` (which Jest can't render) mapping `MAIN_TABS` into `MainTabs()`
 * as is; a `<Tab.Screen>` added there directly, or a filter on the list,
 * would not fail here.
 */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import BottomTabBar from "../../components/shared/BottomTabBar";
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

describe("main tabs", () => {
  it("are exactly Lobby, Profile and Settings", () => {
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
