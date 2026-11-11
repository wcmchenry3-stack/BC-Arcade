/** #2221: the best-score label is translated, not the literal "HIGH". */
import React from "react";
import { render, screen } from "@testing-library/react-native";
import i18n from "i18next";
import DeCascade from "../../../i18n/locales/de/cascade.json";

import ScoreDisplay from "../ScoreDisplay";
import { ThemeProvider } from "../../../theme/ThemeContext";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

const mount = () =>
  render(
    <ThemeProvider>
      <ScoreDisplay score={10} />
    </ThemeProvider>
  );

describe("Cascade ScoreDisplay high label (#2221)", () => {
  it("shows the English label by default", async () => {
    await mount();
    expect(screen.getByText("High")).toBeTruthy();
    expect(screen.queryByText("HIGH")).toBeNull();
  });

  it("shows the translated label in German", async () => {
    await i18n.changeLanguage("de");
    i18n.addResourceBundle("de", "cascade", DeCascade);
    await mount();
    expect(screen.getByText("Rekord")).toBeTruthy();
    expect(screen.queryByText("High")).toBeNull();
  });
});

// The Maestro Cascade demo (e2e/maestro/flows/cascade/demo-merge.yaml) waits on
// this testID's text to see that a merge scored points (#3705).
describe("Cascade ScoreDisplay score testID (#3705)", () => {
  it("puts the current score on `cascade-score`", async () => {
    await mount();
    expect(screen.getByTestId("cascade-score")).toHaveTextContent("10");
  });
});
