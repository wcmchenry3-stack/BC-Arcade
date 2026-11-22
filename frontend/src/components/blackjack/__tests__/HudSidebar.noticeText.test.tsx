/**
 * #3819: the HUD notice chip's text reads on its fill in the light theme (cream `surface` text on
 * a bonus, secondary or table-accent fill fails 4.5:1); dark keeps the surface text it always had.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { render, screen } from "@testing-library/react-native";
import type { SharedValue } from "react-native-reanimated";

import HudSidebar from "../HudSidebar";
import type { HudNoticeData, HudNoticeKind } from "../HudNotice";
import * as ThemeModule from "../../../theme/ThemeContext";
import { dark, light } from "../../../theme/ThemeContext";

function notice(kind: HudNoticeKind, background: string): HudNoticeData {
  return {
    kind,
    text: "Notice",
    label: "Notice label",
    opacity: { value: 1 } as SharedValue<number>,
    background,
  };
}

function chipTextColor(): string | undefined {
  const flat = StyleSheet.flatten(screen.getByText("Notice").props.style) as { color?: string };
  return flat.color;
}

function mount(n: HudNoticeData, theme: "light" | "dark") {
  const colors = theme === "light" ? light : dark;
  jest.spyOn(ThemeModule, "useTheme").mockReturnValue({
    colors,
    theme,
  } as ReturnType<typeof ThemeModule.useTheme>);
  return render(
    <HudSidebar
      chips={500}
      startingChips={500}
      runGoal={1000}
      milestones={[]}
      tableName="Intermediate"
      tableAccentColor={colors.secondary}
      notice={n}
    />
  );
}

afterEach(() => jest.restoreAllMocks());

describe("HudSidebar notice text (#3819)", () => {
  it("light: comeback uses textOnBonus", async () => {
    await mount(notice("comeback", light.bonus), "light");
    expect(chipTextColor()).toBe(light.textOnBonus);
  });

  it("light: all-in on the secondary fill uses textOnSecondary", async () => {
    await mount(notice("allIn", light.secondary), "light");
    expect(chipTextColor()).toBe(light.textOnSecondary);
  });

  it("light: a milestone on the accent fill uses textOnAccent", async () => {
    await mount(notice("milestone", light.accent), "light");
    expect(chipTextColor()).toBe(light.textOnAccent);
  });

  it.each(["comeback", "allIn", "milestone"] as const)("dark: %s keeps surface text", async (k) => {
    await mount(notice(k, dark.secondary), "dark");
    expect(chipTextColor()).toBe(dark.surface);
  });
});
