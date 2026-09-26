import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { DifficultyPicker, type DifficultyOption } from "../DifficultyPicker";
import { __setPremiumLevelsForTests } from "../../../entitlements/premiumLevels";

type Level = "easy" | "hard" | "expert" | "mixed";

const OPTIONS: DifficultyOption<Level>[] = [
  { value: "easy", label: "Easy" },
  { value: "hard", label: "Hard", description: "For experts" },
  { value: "expert", label: "Expert" },
  { value: "mixed", label: "Mixed", fullWidth: true },
];

async function renderPicker(value: Level = "easy") {
  const onChange = jest.fn();
  await render(
    <ThemeProvider>
      <DifficultyPicker
        gameKey="test"
        options={OPTIONS}
        value={value}
        onChange={onChange}
        accessibilityLabel="Difficulty"
        testID="pick"
      />
    </ThemeProvider>
  );
  return { onChange };
}

beforeEach(() => {
  __setPremiumLevelsForTests({ test: ["expert"], other: ["easy"] });
});

afterEach(() => {
  __setPremiumLevelsForTests(null);
});

describe("DifficultyPicker", () => {
  it("is a radio group with one radio per option, the value checked", async () => {
    await renderPicker("hard");
    expect(screen.getByLabelText("Difficulty").props.accessibilityRole).toBe("radiogroup");
    const radios = screen.getAllByRole("radio");
    expect(radios).toHaveLength(4);
    expect(screen.getByTestId("pick-hard").props.accessibilityState).toEqual({ checked: true });
    expect(screen.getByTestId("pick-easy").props.accessibilityState).toEqual({ checked: false });
  });

  it("shows an option's description under its label", async () => {
    await renderPicker();
    expect(screen.getByText("For experts")).toBeTruthy();
  });

  it("reports a tap on an open option", async () => {
    const { onChange } = await renderPicker();
    await fireEvent.press(screen.getByTestId("pick-hard"));
    expect(onChange).toHaveBeenCalledWith("hard");
  });

  it("puts a full-width option on a row of its own", async () => {
    await renderPicker();
    // The nearest host ancestor laid out as a row.
    const rowOf = (id: string) => {
      let node = screen.getByTestId(id).parent;
      while (node && StyleSheet.flatten(node.props.style)?.flexDirection !== "row") {
        node = node.parent;
      }
      return node;
    };
    expect(rowOf("pick-easy")).toBeTruthy();
    expect(rowOf("pick-easy")).toBe(rowOf("pick-expert"));
    expect(rowOf("pick-mixed")).not.toBe(rowOf("pick-easy"));
  });

  describe("a premium option", () => {
    it("is one of its own game's premium levels, not another game's", async () => {
      await renderPicker();
      expect(screen.getByText("Easy")).toBeTruthy();
      expect(screen.queryByText("🔒 Easy")).toBeNull();
    });

    it("shows a lock and says so to screen readers", async () => {
      await renderPicker();
      expect(screen.getByText("🔒 Expert")).toBeTruthy();
      expect(screen.getByTestId("pick-expert").props.accessibilityLabel).toBe(
        "Expert, locked. Part of BC Arcade Premium."
      );
    });

    it("explains the lock on tap instead of picking it", async () => {
      const { onChange } = await renderPicker();
      expect(
        screen.queryByText("This level is part of BC Arcade Premium, coming soon.")
      ).toBeNull();

      await fireEvent.press(screen.getByTestId("pick-expert"));
      expect(onChange).not.toHaveBeenCalled();
      expect(screen.getByText("BC Arcade Premium")).toBeTruthy();
      expect(
        screen.getByText("This level is part of BC Arcade Premium, coming soon.")
      ).toBeTruthy();

      await fireEvent.press(screen.getByTestId("pick-premium-ok"));
      expect(
        screen.queryByText("This level is part of BC Arcade Premium, coming soon.")
      ).toBeNull();
    });
  });
});
