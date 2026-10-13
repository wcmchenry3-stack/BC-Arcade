/** #2221: the visible "free" watermark on an empty free cell is translated. */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import DeFreecell from "../../../i18n/locales/de/freecell.json";

import FreeCellSlot from "../FreeCellSlot";
import { ThemeProvider } from "../../../theme/ThemeContext";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const mount = () =>
  render(
    <ThemeProvider>
      <FreeCellSlot card={null} cellIndex={0} />
    </ThemeProvider>
  );

describe("FreeCellSlot watermark (#2221)", () => {
  it("shows the English word by default", async () => {
    await mount();
    expect(screen.getByText("free")).toBeTruthy();
  });

  it("shows the translated word in German", async () => {
    await i18n.changeLanguage("de");
    i18n.addResourceBundle("de", "freecell", DeFreecell);
    await mount();
    expect(screen.getByText("frei")).toBeTruthy();
    expect(screen.queryByText("free")).toBeNull();
  });
});
