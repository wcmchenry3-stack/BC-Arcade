import React from "react";
import { render, act } from "@testing-library/react-native";
import { AccessibilityInfo } from "react-native";
import FeedbackThanksBanner, { THANKS_BANNER_DURATION_MS } from "../FeedbackThanksBanner";
import { ThemeProvider } from "../../../theme/ThemeContext";

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(AccessibilityInfo, "announceForAccessibility").mockImplementation(() => {});
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function renderBanner(visible: boolean, onDismiss = jest.fn()) {
  const ui = await render(
    <ThemeProvider>
      <FeedbackThanksBanner visible={visible} onDismiss={onDismiss} />
    </ThemeProvider>
  );
  return { onDismiss, ...ui };
}

describe("FeedbackThanksBanner", () => {
  it("renders nothing when not visible", async () => {
    const { queryByTestId } = await renderBanner(false);
    expect(queryByTestId("feedback-thanks-banner")).toBeNull();
  });

  it("shows the thank-you in a polite live region and announces it", async () => {
    const { getByTestId, getByText } = await renderBanner(true);
    expect(getByText("Thanks for your feedback!")).toBeTruthy();
    expect(getByTestId("feedback-thanks-banner").props.accessibilityLiveRegion).toBe("polite");
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      "Thanks for your feedback!"
    );
  });

  it("dismisses itself after the timeout, not before", async () => {
    const { onDismiss } = await renderBanner(true);
    await act(async () => {
      jest.advanceTimersByTime(THANKS_BANNER_DURATION_MS - 1);
    });
    expect(onDismiss).not.toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
