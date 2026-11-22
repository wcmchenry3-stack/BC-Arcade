import React from "react";
import { Dimensions } from "react-native";
import { render, cleanup } from "@testing-library/react-native";
import i18n from "i18next";
import { YachtCelebrationAnimation, celebrationFontSize } from "../YachtCelebrationAnimation";

// #3748 (audit bug 7): YACHT! and JOKER! come from the yacht namespace, not the source, and a
// longer word in another language has to fit a 320 pt phone.

const LOCALES = ["fr-CA", "es", "de", "pt", "nl", "ru", "zh", "ja", "ko", "hi", "ar", "he"];

beforeAll(() => {
  for (const code of LOCALES) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    i18n.addResourceBundle(code, "yacht", require(`../../../i18n/locales/${code}/yacht.json`));
  }
});

afterEach(async () => {
  await cleanup();
  await i18n.changeLanguage("en");
});

afterAll(() => {
  for (const code of LOCALES) i18n.removeResourceBundle(code, "yacht");
});

describe("the celebration words go through i18n (#3748)", () => {
  it("English: YACHT! and JOKER!", async () => {
    const yacht = await render(<YachtCelebrationAnimation visible onDismiss={jest.fn()} />);
    expect(yacht.getByTestId("yacht-celebration-text")).toHaveTextContent("YACHT!");
    await yacht.unmount();
    const joker = await render(
      <YachtCelebrationAnimation visible variant="joker" onDismiss={jest.fn()} />
    );
    expect(joker.getByTestId("yacht-celebration-text")).toHaveTextContent("JOKER!");
  });

  it.each([
    ["es", "¡COMODÍN!"],
    ["pt", "CORINGA!"],
    ["ru", "ДЖОКЕР!"],
    ["zh", "百搭！"],
  ])("%s: the joker is %s", async (code, word) => {
    await i18n.changeLanguage(code);
    const { getByTestId } = await render(
      <YachtCelebrationAnimation visible variant="joker" onDismiss={jest.fn()} />
    );
    expect(getByTestId("yacht-celebration-text")).toHaveTextContent(word);
  });

  it("the game's name stays YACHT! in every language", async () => {
    for (const code of LOCALES) {
      await i18n.changeLanguage(code);
      expect(i18n.t("yacht:celebration.yacht")).toBe("YACHT!");
    }
  });

  it("every locale has both words", () => {
    for (const code of ["en", ...LOCALES]) {
      expect(i18n.getResource(code, "yacht", "celebration.yacht")).toBeTruthy();
      expect(i18n.getResource(code, "yacht", "celebration.joker")).toBeTruthy();
    }
  });
});

describe("celebrationFontSize: the word fits the screen", () => {
  const CHAR_EM = 0.78; // a capital with its letter spacing, as the component assumes
  const BADGE_PAD = 24;
  const MARGIN = 16;

  it("is 42 pt where there is room", () => {
    expect(celebrationFontSize("YACHT!", 390)).toBe(42);
    expect(celebrationFontSize("JOKER!", 390)).toBe(42);
  });

  it.each([320, 360, 390])("%d pt: every word's width fits inside the screen margin", (width) => {
    const words = ["YACHT!", "JOKER!", "¡COMODÍN!", "CORINGA!", "ДЖОКЕР!", "百搭！", "ג'וקר!"];
    for (const w of words) {
      const size = celebrationFontSize(w, width);
      expect(size).toBeGreaterThanOrEqual(20);
      if (size > 20) {
        expect(w.length * size * CHAR_EM + 2 * BADGE_PAD).toBeLessThanOrEqual(width - 2 * MARGIN);
      }
    }
  });

  it("shrinks the longest word on a 320 pt phone (Spanish's ¡COMODÍN!)", () => {
    expect(celebrationFontSize("¡COMODÍN!", 320)).toBeLessThan(42);
  });

  it("renders the shrunk size on a 320 pt phone", async () => {
    const spy = jest
      .spyOn(Dimensions, "get")
      .mockReturnValue({ width: 320, height: 568, scale: 2, fontScale: 1 });
    await i18n.changeLanguage("es");
    const { getByTestId } = await render(
      <YachtCelebrationAnimation visible variant="joker" onDismiss={jest.fn()} />
    );
    const size = (getByTestId("yacht-celebration-text").props.style as { fontSize?: number }[])
      .flat()
      .find((s) => s?.fontSize)?.fontSize;
    expect(size).toBeLessThan(42);
    spy.mockRestore();
  });
});
