import React from "react";
import { Platform, StyleSheet } from "react-native";
import { render, screen, fireEvent } from "@testing-library/react-native";
import type { BottomTabBarProps } from "@react-navigation/bottom-tabs";
import BottomTabBar from "../BottomTabBar";

jest.mock("expo-blur", () => ({
  BlurView: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("expo-linear-gradient", () => ({
  LinearGradient: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));

jest.mock("react-native-safe-area-context", () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 34, left: 0, right: 0 }),
}));

jest.mock("../../../theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: {
      background: "#0e0e13",
      accent: "#8ff5ff",
      accentBright: "#00eefc",
      text: "#e8e8f0",
      textOnAccent: "#0e0e13",
      chromeBg: "rgba(14,14,19,0.7)",
      chromeShadowColor: "#8ff5ff",
      chromeShadowOpacity: 0.08,
    },
    theme: "dark",
  }),
}));

jest.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        "nav.lobby": "Lobby",
        "nav.ranks": "Ranks",
        "nav.profile": "Profile",
        "nav.settings": "Settings",
      };
      return map[key] ?? key;
    },
  }),
}));

jest.mock("@expo/vector-icons/MaterialIcons", () => "MockMaterialIcons");

function buildProps(activeIndex = 0): BottomTabBarProps {
  const routes = [
    { key: "lobby", name: "Lobby" },
    { key: "ranks", name: "Ranks" },
    { key: "profile", name: "Profile" },
    { key: "settings", name: "Settings" },
  ] as BottomTabBarProps["state"]["routes"];
  return {
    state: { routes, index: activeIndex } as BottomTabBarProps["state"],
    navigation: { navigate: jest.fn() } as unknown as BottomTabBarProps["navigation"],
    descriptors: {} as BottomTabBarProps["descriptors"],
    insets: { top: 0, bottom: 0, left: 0, right: 0 },
  };
}

describe("BottomTabBar", () => {
  it("renders all four tab labels", () => {
    render(<BottomTabBar {...buildProps()} />);
    expect(screen.getByText("Lobby")).toBeTruthy();
    expect(screen.getByText("Ranks")).toBeTruthy();
    expect(screen.getByText("Profile")).toBeTruthy();
    expect(screen.getByText("Settings")).toBeTruthy();
  });

  it("renders a container with accessibilityRole tablist", () => {
    const { UNSAFE_getByProps } = render(<BottomTabBar {...buildProps()} />);
    expect(UNSAFE_getByProps({ accessibilityRole: "tablist" })).toBeTruthy();
  });

  it("each tab has accessibilityRole tab", () => {
    const { getAllByRole } = render(<BottomTabBar {...buildProps()} />);
    const tabs = getAllByRole("tab");
    expect(tabs).toHaveLength(4);
  });

  it("active tab has accessibilityState selected=true", () => {
    const { getAllByRole } = render(<BottomTabBar {...buildProps(1)} />);
    const tabs = getAllByRole("tab");
    expect(tabs[1].props.accessibilityState.selected).toBe(true);
  });

  it("inactive tabs have accessibilityState selected=false", () => {
    const { getAllByRole } = render(<BottomTabBar {...buildProps(0)} />);
    const tabs = getAllByRole("tab");
    expect(tabs[1].props.accessibilityState.selected).toBe(false);
    expect(tabs[2].props.accessibilityState.selected).toBe(false);
    expect(tabs[3].props.accessibilityState.selected).toBe(false);
  });

  it("calls navigate with route name on press", () => {
    const navigate = jest.fn();
    const props = buildProps(0);
    props.navigation.navigate = navigate;
    render(<BottomTabBar {...props} />);
    fireEvent.press(screen.getByText("Ranks"));
    expect(navigate).toHaveBeenCalledWith("Ranks");
  });

  it("does not render any emoji characters", () => {
    render(<BottomTabBar {...buildProps()} />);
    // Emoji used in old implementation — should be gone
    expect(screen.queryByText("🏠")).toBeNull();
    expect(screen.queryByText("🏆")).toBeNull();
    expect(screen.queryByText("👤")).toBeNull();
    expect(screen.queryByText("⚙️")).toBeNull();
  });

  it("wrapper has flexShrink 0 on native", () => {
    const { UNSAFE_getByProps } = render(<BottomTabBar {...buildProps()} />);
    const wrapper = UNSAFE_getByProps({ accessibilityRole: "tablist" });
    const flat = StyleSheet.flatten(wrapper.props.style);
    expect(flat.flexShrink).toBe(0);
  });
});

describe("BottomTabBar — web platform", () => {
  beforeEach(() => {
    Object.defineProperty(Platform, "OS", { value: "web", configurable: true });
  });
  afterEach(() => {
    Object.defineProperty(Platform, "OS", { value: "ios", configurable: true });
  });

  it("applies alignSelf stretch on the wrapper", () => {
    const { UNSAFE_getByProps } = render(<BottomTabBar {...buildProps()} />);
    const wrapper = UNSAFE_getByProps({ accessibilityRole: "tablist" });
    const flat = StyleSheet.flatten(wrapper.props.style);
    expect(flat.alignSelf).toBe("stretch");
  });

  it("retains flexShrink 0 on the wrapper", () => {
    const { UNSAFE_getByProps } = render(<BottomTabBar {...buildProps()} />);
    const wrapper = UNSAFE_getByProps({ accessibilityRole: "tablist" });
    const flat = StyleSheet.flatten(wrapper.props.style);
    expect(flat.flexShrink).toBe(0);
  });
});
