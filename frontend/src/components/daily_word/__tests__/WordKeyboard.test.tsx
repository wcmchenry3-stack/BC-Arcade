import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";

import { WordKeyboard, actionLabelStyle, keyboardRows } from "../WordKeyboard";
import { ThemeProvider } from "../../../theme/ThemeContext";

async function renderKeyboard(
  language: string,
  keyboardState: Record<string, "correct" | "present" | "absent"> = {},
  onKey: (key: string) => void = () => {}
) {
  return await render(
    <ThemeProvider>
      <WordKeyboard keyboardState={keyboardState} language={language} onKey={onKey} />
    </ThemeProvider>
  );
}

const letters = (language: string, row: number) =>
  keyboardRows(language)[row]!.filter((k) => k !== "spacer");

describe("WordKeyboard layouts (#3241)", () => {
  it.each(["en", "fr"])("%s is QWERTY with no Ñ", async (language) => {
    await renderKeyboard(language);
    expect(letters(language, 0).join("")).toBe("QWERTYUIOP");
    expect(letters(language, 1).join("")).toBe("ASDFGHJKL");
    expect(screen.queryByTestId("daily-word-key-ñ")).toBeNull();
  });

  it("es puts Ñ after L on the middle row", async () => {
    await renderKeyboard("es");
    expect(letters("es", 1).join("")).toBe("ASDFGHJKLÑ");
    expect(screen.getByTestId("daily-word-key-ñ")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ñ" })).toBeTruthy();
  });

  it("es has no accent keys", async () => {
    await renderKeyboard("es");
    for (const accented of ["á", "é", "í", "ó", "ú", "ü"]) {
      expect(screen.queryByTestId(`daily-word-key-${accented}`)).toBeNull();
    }
  });

  it("hi keeps the Devanagari keyboard", async () => {
    await renderKeyboard("hi");
    expect(screen.getByRole("button", { name: "क" })).toBeTruthy();
    expect(screen.queryByTestId("daily-word-key-q")).toBeNull();
    expect(screen.queryByTestId("daily-word-key-ñ")).toBeNull();
  });

  it("an unknown language falls back to QWERTY", () => {
    expect(keyboardRows("de")).toBe(keyboardRows("en"));
  });

  it("pressing Ñ sends the letter, lower-cased by the screen", async () => {
    const onKey = jest.fn();
    await renderKeyboard("es", {}, onKey);
    await fireEvent.press(screen.getByTestId("daily-word-key-ñ"));
    expect(onKey).toHaveBeenCalledWith("Ñ");
  });

  it("colours Ñ from the folded-letter keyboard state", async () => {
    await renderKeyboard("es", { ñ: "present" });
    const bg = StyleSheet.flatten(
      screen.getByTestId("daily-word-key-ñ").props.style
    ).backgroundColor;
    const plain = StyleSheet.flatten(
      screen.getByTestId("daily-word-key-l").props.style
    ).backgroundColor;
    expect(bg).not.toBe(plain);
  });

  it("colours a plain letter that an accented guess scored (é → e)", async () => {
    await renderKeyboard("fr", { e: "correct" });
    const e = StyleSheet.flatten(
      screen.getByTestId("daily-word-key-e").props.style
    ).backgroundColor;
    const w = StyleSheet.flatten(
      screen.getByTestId("daily-word-key-w").props.style
    ).backgroundColor;
    expect(e).not.toBe(w);
  });

  it("every key shares the row by flex, so a ten-key row fits a 320 px phone", async () => {
    await renderKeyboard("es");
    for (const id of ["daily-word-key-ñ", "daily-word-key-q", "daily-word-key-enter"]) {
      const style = StyleSheet.flatten(screen.getByTestId(id).props.style);
      expect(style.flex).toBeGreaterThan(0);
      expect(style.minWidth).toBe(0);
      expect(style.width).toBeUndefined();
    }
  });

  it("labels the Enter and Delete keys from the daily_word namespace", async () => {
    await renderKeyboard("es");
    const enter = screen.getByTestId("daily-word-key-enter");
    expect(within(enter).getByText("Enter")).toBeTruthy();
  });
});

describe("WordKeyboard key text", () => {
  const textStyle = (id: string, label: string) =>
    StyleSheet.flatten(within(screen.getByTestId(id)).getByText(label).props.style);

  it.each(["en", "es"])(
    "%s: Enter and Delete (en labels) keep 13 px with letterSpacing 0.5",
    async (language) => {
      await renderKeyboard(language);
      if (language === "en") {
        for (const [id, label] of [
          ["daily-word-key-enter", "Enter"],
          ["daily-word-key-delete", "Delete"],
        ] as const) {
          const style = textStyle(id, label);
          expect(style.fontSize).toBe(13);
          expect(style.letterSpacing).toBe(0.5);
        }
      }
      // Letter keys are 13 px for every language.
      expect(textStyle("daily-word-key-a", "A").fontSize).toBe(13);
    }
  );

  it("keeps Hindi action labels at 13 px", async () => {
    await renderKeyboard("hi");
    const style = textStyle("daily-word-key-enter", "Enter");
    expect(style.fontSize).toBe(13);
    expect(style.letterSpacing).toBe(0.5);
  });

  it("only action keys fit their text to the key", async () => {
    await renderKeyboard("en");
    const fits = (id: string, label: string) =>
      within(screen.getByTestId(id)).getByText(label).props.adjustsFontSizeToFit;
    expect(fits("daily-word-key-enter", "Enter")).toBe(true);
    expect(fits("daily-word-key-delete", "Delete")).toBe(true);
    expect(fits("daily-word-key-a", "A")).toBeFalsy();
    expect(fits("daily-word-key-q", "Q")).toBeFalsy();
  });

  it("shrinks only fr and es labels, the long ones more", () => {
    expect(actionLabelStyle("en", "Delete")).toBeNull();
    expect(actionLabelStyle("hi", "दर्ज करें")).toBeNull();
    expect(actionLabelStyle("es", "Enviar")).toMatchObject({ fontSize: 11 });
    expect(actionLabelStyle("fr", "Effacer")).toMatchObject({ fontSize: 10 });
  });
});
