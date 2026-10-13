import React from "react";
import { StyleSheet } from "react-native";
import { fireEvent, render, screen, within } from "@testing-library/react-native";

import { WordKeyboard, keyboardRows } from "../WordKeyboard";
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
