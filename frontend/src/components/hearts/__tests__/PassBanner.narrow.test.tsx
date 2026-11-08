/**
 * PassBanner on a narrow table (#3587): the prompt gets two lines and the pass direction is
 * never cut; the "N of 3 selected" line is dropped (the count stays in the Confirm label).
 */
import React from "react";
import { StyleSheet } from "react-native";
import { act, fireEvent, render } from "@testing-library/react-native";
import i18n from "i18next";
import { ThemeProvider } from "../../../theme/ThemeContext";
import EnHearts from "../../../i18n/locales/en/hearts.json";
import PassBanner, { NARROW_BANNER_WIDTH } from "../PassBanner";

const layout = (width: number) => ({ nativeEvent: { layout: { x: 0, y: 0, width, height: 40 } } });

async function mount(selected = 2) {
  const api = await render(
    <ThemeProvider>
      <PassBanner passDirection="across" selectedCount={selected} onConfirm={jest.fn()} />
    </ThemeProvider>
  );
  return api;
}

describe("PassBanner narrow", () => {
  afterEach(() => {
    i18n.removeResourceBundle("en", "hearts");
    i18n.addResourceBundle("en", "hearts", EnHearts, true, true);
  });

  it("gives the prompt two lines at 14/17", async () => {
    const { getByText } = await mount();
    const prompt = getByText(/Choose 3 cards/);
    expect(prompt.props.numberOfLines).toBe(2);
    const style = StyleSheet.flatten(prompt.props.style);
    expect([style.fontSize, style.lineHeight]).toEqual([14, 17]);
  });

  it("is tighter: 6 dp vertical padding and an 8 dp gap", async () => {
    const { getByTestId } = await mount();
    const style = StyleSheet.flatten(getByTestId("hearts-pass-banner").props.style);
    expect([style.paddingVertical, style.gap]).toEqual([6, 8]);
  });

  it("hides the counter under the narrow width, and keeps the count in the Confirm label", async () => {
    const { getByTestId, queryByText, getByLabelText } = await mount(2);
    expect(queryByText("2 of 3 selected")).toBeTruthy();
    await act(async () => {
      fireEvent(getByTestId("hearts-pass-banner"), "layout", layout(NARROW_BANNER_WIDTH - 1));
    });
    expect(queryByText("2 of 3 selected")).toBeNull();
    expect(getByLabelText("Confirm — pass 2 selected cards")).toBeTruthy();
    await act(async () => {
      fireEvent(getByTestId("hearts-pass-banner"), "layout", layout(NARROW_BANNER_WIDTH + 40));
    });
    expect(queryByText("2 of 3 selected")).toBeTruthy();
  });

  it("with a long direction at 320 dp, the direction stays in the prompt and the counter is gone", async () => {
    i18n.addResource(
      "en",
      "hearts",
      "pass.direction.across",
      "Pass across the table to the player opposite"
    );
    const { getByTestId, getByText, queryByText } = await mount(1);
    await act(async () => {
      fireEvent(getByTestId("hearts-pass-banner"), "layout", layout(220));
    });
    const prompt = getByText(/Choose 3 cards to Pass across the table to the player opposite/);
    // The whole direction is in the text and has two lines to wrap over, not one to be cut in.
    expect(prompt.props.numberOfLines).toBe(2);
    expect(queryByText("1 of 3 selected")).toBeNull();
  });
});
