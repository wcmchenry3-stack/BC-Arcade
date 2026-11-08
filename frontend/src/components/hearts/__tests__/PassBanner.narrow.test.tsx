/**
 * PassBanner on a narrow table (#3587): the title and the pass direction are two lines, so the
 * direction is never cut in any language; the "N of 3 selected" line is not drawn without room
 * but stays in the live region for a screen reader; the narrow state can come from the caller.
 */
import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import i18n from "i18next";
import { ThemeProvider } from "../../../theme/ThemeContext";
import EnHearts from "../../../i18n/locales/en/hearts.json";
import DeHearts from "../../../i18n/locales/de/hearts.json";
import RuHearts from "../../../i18n/locales/ru/hearts.json";
import PassBanner from "../PassBanner";
import {
  COUNTER_MIN_BANNER_H,
  NARROW_BANNER_WIDTH,
  bannerHeightNeeded,
} from "../../../game/hearts/layout";
import type { PassDirection } from "../../../game/hearts/types";

const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } } });

type Extra = Partial<React.ComponentProps<typeof PassBanner>>;

async function mount(selected = 2, direction: PassDirection = "across", extra: Extra = {}) {
  return await render(
    <ThemeProvider>
      <PassBanner
        passDirection={direction}
        selectedCount={selected}
        onConfirm={jest.fn()}
        {...extra}
      />
    </ThemeProvider>
  );
}

const hidden = (el: { props: { style?: unknown } }) =>
  StyleSheet.flatten(el.props.style as never).width === 1;

afterEach(async () => {
  i18n.removeResourceBundle("en", "hearts");
  i18n.addResourceBundle("en", "hearts", EnHearts, true, true);
  await i18n.changeLanguage("en");
});

describe("PassBanner two-line prompt", () => {
  it("puts the title and the direction on their own single lines, shrinking to fit", async () => {
    const { getByText } = await mount(0, "left");
    for (const text of ["Choose 3 cards", "Pass left"]) {
      const line = getByText(text);
      expect(line.props.numberOfLines).toBe(1);
      expect(line.props.adjustsFontSizeToFit).toBe(true);
      expect(line.props.minimumFontScale).toBe(0.8);
    }
  });

  it("is tighter: 6 dp vertical padding and an 8 dp gap", async () => {
    const { getByTestId } = await mount();
    const style = StyleSheet.flatten(getByTestId("hearts-pass-banner").props.style);
    expect([style.paddingVertical, style.gap]).toEqual([6, 8]);
  });

  it("needs 47 dp for two lines and 62 dp with the count", () => {
    expect(bannerHeightNeeded(false)).toBe(47);
    expect(COUNTER_MIN_BANNER_H).toBe(62);
  });

  it("keeps the whole direction on its line in German and Russian, at 214 dp wide", async () => {
    i18n.addResourceBundle("de", "hearts", DeHearts, true, true);
    i18n.addResourceBundle("ru", "hearts", RuHearts, true, true);
    await i18n.changeLanguage("de");
    const de = await mount(0, "right", { narrow: true });
    expect(de.getByText("Nach rechts geben").props.numberOfLines).toBe(1);
    expect(de.getByText("Wähle 3 Karten").props.numberOfLines).toBe(1);
    await de.unmount();
    await i18n.changeLanguage("ru");
    const ru = await mount(0, "across", { narrow: true });
    expect(ru.getByText("Передать напротив").props.numberOfLines).toBe(1);
  });

  it("keeps a very long direction string on its one line, not wrapped over the title", async () => {
    i18n.addResource(
      "en",
      "hearts",
      "pass.direction.across",
      "Pass across the table to the player opposite"
    );
    const { getByText } = await mount(1, "across", { narrow: true });
    expect(getByText("Pass across the table to the player opposite").props.numberOfLines).toBe(1);
    expect(getByText("Choose 3 cards").props.numberOfLines).toBe(1);
  });
});

describe("PassBanner count line", () => {
  it("draws the count when wide with room, and hides it (but keeps it) otherwise", async () => {
    const wide = await mount(2, "left", { narrow: false, roomForCounter: true });
    expect(hidden(wide.getByText("2 of 3 selected"))).toBe(false);
    await wide.unmount();

    const noRoom = await mount(2, "left", { narrow: false, roomForCounter: false });
    const counter = noRoom.getByText("2 of 3 selected");
    // Not drawn, but still text in the live region: it is announced as the count changes.
    expect(hidden(counter)).toBe(true);
    expect(noRoom.getByTestId("hearts-pass-banner").props.accessibilityLiveRegion).toBe("polite");
    await noRoom.unmount();

    const narrow = await mount(2, "left", { narrow: true });
    expect(hidden(narrow.getByText("2 of 3 selected"))).toBe(true);
    expect(narrow.getByLabelText("Confirm — pass 2 selected cards")).toBeTruthy();
  });

  it("follows the measured width only when the caller does not say", async () => {
    const { getByTestId, getByText } = await mount(2);
    expect(hidden(getByText("2 of 3 selected"))).toBe(false);
    await act(async () => {
      fireEvent(getByTestId("hearts-pass-banner"), "layout", layout(NARROW_BANNER_WIDTH - 1));
    });
    expect(hidden(getByText("2 of 3 selected"))).toBe(true);
    await act(async () => {
      fireEvent(getByTestId("hearts-pass-banner"), "layout", layout(NARROW_BANNER_WIDTH + 40));
    });
    expect(hidden(getByText("2 of 3 selected"))).toBe(false);
  });

  it("ignores the measured width when the caller passes narrow, so there is no wide-then-narrow frame", async () => {
    const { getByTestId, getByText } = await mount(2, "left", { narrow: true });
    expect(hidden(getByText("2 of 3 selected"))).toBe(true);
    expect(getByTestId("hearts-pass-banner").props.onLayout).toBeUndefined();
  });
});
