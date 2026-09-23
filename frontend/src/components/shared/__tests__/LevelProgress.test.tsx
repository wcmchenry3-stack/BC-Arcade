import React from "react";
import { render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import LevelProgress, { levelProgressPercent } from "../LevelProgress";

async function renderLevel(props: React.ComponentProps<typeof LevelProgress>) {
  return await render(
    <ThemeProvider>
      <LevelProgress {...props} />
    </ThemeProvider>
  );
}

describe("levelProgressPercent", () => {
  it("is the share of the current level's bucket already earned", () => {
    expect(levelProgressPercent(50, 150)).toBe(25);
  });

  it("is 0 at the start of a level", () => {
    expect(levelProgressPercent(0, 100)).toBe(0);
  });

  it("is 100 at max level, where the server reports 0 XP to the next level", () => {
    expect(levelProgressPercent(500, 0)).toBe(100);
  });

  it("rounds down so the bar never reads 100% before the level is reached", () => {
    expect(levelProgressPercent(299, 1)).toBe(99);
  });

  it("clamps malformed input into 0–100", () => {
    expect(levelProgressPercent(-5, 100)).toBe(0);
    expect(levelProgressPercent(Number.NaN, 100)).toBe(0);
  });
});

describe("LevelProgress", () => {
  it("shows the level, total XP and the XP still needed for the next level", async () => {
    await renderLevel({ level: 3, totalXp: 300, xpIntoLevel: 50, xpForNextLevel: 150 });
    expect(screen.getByText("Level 3")).toBeTruthy();
    expect(screen.getByText("300 XP")).toBeTruthy();
    expect(screen.getByText("150 XP to level 4")).toBeTruthy();
  });

  it("exposes the bar as a progressbar with its value", async () => {
    await renderLevel({ level: 3, totalXp: 300, xpIntoLevel: 50, xpForNextLevel: 150 });
    const bar = screen.getByRole("progressbar");
    expect(bar.props.accessibilityLabel).toBe("Progress to level 4");
    expect(bar.props.accessibilityValue).toEqual({ min: 0, max: 100, now: 25 });
  });

  it("renders a brand-new player as level 1 with an empty bar", async () => {
    await renderLevel({ level: 1, totalXp: 0, xpIntoLevel: 0, xpForNextLevel: 100 });
    expect(screen.getByText("Level 1")).toBeTruthy();
    expect(screen.getByText("100 XP to level 2")).toBeTruthy();
    expect(screen.getByRole("progressbar").props.accessibilityValue.now).toBe(0);
  });

  it("shows a full bar and the max-level message at max level", async () => {
    await renderLevel({ level: 10, totalXp: 3700, xpIntoLevel: 500, xpForNextLevel: 0 });
    expect(screen.getByText("Level 10")).toBeTruthy();
    expect(screen.getByText("Max level reached")).toBeTruthy();
    expect(screen.queryByText(/XP to level/)).toBeNull();
    const bar = screen.getByRole("progressbar");
    expect(bar.props.accessibilityLabel).toBe("Max level reached");
    expect(bar.props.accessibilityValue.now).toBe(100);
  });
});
