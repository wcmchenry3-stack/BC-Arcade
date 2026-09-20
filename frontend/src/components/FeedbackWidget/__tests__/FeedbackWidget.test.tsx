import React from "react";
import { render, renderHook, fireEvent, act, waitFor } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import FeedbackWidget from "../FeedbackWidget";
import { ThemeProvider } from "../../../theme/ThemeContext";
import { SessionLogger } from "../SessionLogger";
import {
  _resetFeedbackRateLimit,
  FEEDBACK_RATE_LIMIT_MAX,
  useFeedbackSubmit,
} from "../useFeedbackSubmit";

const mockCaptureFeedback = Sentry.captureFeedback as jest.Mock;
const mockGetClient = Sentry.getClient as jest.Mock;

beforeEach(() => {
  mockCaptureFeedback.mockReset().mockReturnValue("event-id-1");
  mockGetClient.mockReset().mockReturnValue({});
  _resetFeedbackRateLimit();
  SessionLogger._reset();
});

afterEach(() => {
  SessionLogger._reset();
});

async function renderWidget(opts: { visible?: boolean; onClose?: () => void } = {}) {
  const { visible = true, onClose = jest.fn() } = opts;
  return await render(
    <ThemeProvider>
      <FeedbackWidget visible={visible} onClose={onClose} />
    </ThemeProvider>
  );
}

async function fillAndSubmit(ui: Awaited<ReturnType<typeof renderWidget>>) {
  await fireEvent.changeText(
    ui.getByPlaceholderText("Brief summary of the issue or idea"),
    "My title"
  );
  await fireEvent.changeText(
    ui.getByPlaceholderText("Describe what happened, or what you'd like to see..."),
    "My description"
  );
  await act(async () => {
    await fireEvent.press(ui.getByText("Submit"));
  });
}

describe("FeedbackWidget", () => {
  describe("rendering", () => {
    it("renders the heading when visible", async () => {
      const { getByText } = await renderWidget();
      expect(getByText("Send Feedback")).toBeTruthy();
    });

    it("renders type chips for Bug and Feature request", async () => {
      const { getByText } = await renderWidget();
      expect(getByText("Bug")).toBeTruthy();
      expect(getByText("Feature request")).toBeTruthy();
    });

    it("renders Title and Description fields", async () => {
      const { getByPlaceholderText } = await renderWidget();
      expect(getByPlaceholderText("Brief summary of the issue or idea")).toBeTruthy();
      expect(
        getByPlaceholderText("Describe what happened, or what you'd like to see...")
      ).toBeTruthy();
    });

    it("renders the Submit button", async () => {
      const { getByText } = await renderWidget();
      expect(getByText("Submit")).toBeTruthy();
    });
  });

  describe("close button", () => {
    it("calls onClose when the close button is pressed", async () => {
      const onClose = jest.fn();
      const { getByLabelText } = await renderWidget({ onClose });
      await fireEvent.press(getByLabelText("Close"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });
  });

  describe("validation", () => {
    it("shows title error when submitting without a title", async () => {
      const { getByText } = await renderWidget();
      await act(async () => {
        await fireEvent.press(getByText("Submit"));
      });
      expect(getByText("Title is required.")).toBeTruthy();
      expect(mockCaptureFeedback).not.toHaveBeenCalled();
    });

    it("shows description error when submitting without a description", async () => {
      const { getByText, getByPlaceholderText } = await renderWidget();
      await fireEvent.changeText(
        getByPlaceholderText("Brief summary of the issue or idea"),
        "Some title"
      );
      await act(async () => {
        await fireEvent.press(getByText("Submit"));
      });
      expect(getByText("Description is required.")).toBeTruthy();
      expect(mockCaptureFeedback).not.toHaveBeenCalled();
    });
  });

  describe("successful submission", () => {
    it("sends the feedback to Sentry and shows the success message", async () => {
      const ui = await renderWidget();
      await fillAndSubmit(ui);

      await waitFor(() => {
        expect(ui.getByText("Thanks for your feedback!")).toBeTruthy();
      });
      expect(mockCaptureFeedback).toHaveBeenCalledTimes(1);
      expect(mockCaptureFeedback.mock.calls[0][0]).toMatchObject({
        message: "My title\n\nMy description",
        tags: { "feedback.type": "bug" },
      });
    });
  });

  describe("error states", () => {
    it("shows the rate limit message once the per-install limit is reached", async () => {
      const hook = await renderHook(() => useFeedbackSubmit());
      for (let i = 0; i < FEEDBACK_RATE_LIMIT_MAX; i++) {
        await act(async () => {
          await hook.result.current.submit({ title: "t", description: "d", type: "bug" });
        });
      }
      mockCaptureFeedback.mockClear();

      const ui = await renderWidget();
      await fillAndSubmit(ui);

      await waitFor(() => {
        expect(ui.getByText(/Too many submissions/)).toBeTruthy();
      });
      expect(mockCaptureFeedback).not.toHaveBeenCalled();
    });

    it("shows the generic error when Sentry is not initialised in this build", async () => {
      mockGetClient.mockReturnValue(undefined);
      const ui = await renderWidget();
      await fillAndSubmit(ui);

      await waitFor(() => {
        expect(ui.getByText(/Something went wrong/)).toBeTruthy();
      });
      expect(mockCaptureFeedback).not.toHaveBeenCalled();
    });
  });

  describe("type selection", () => {
    it("switches to Feature request type when chip is pressed", async () => {
      const { getByLabelText } = await renderWidget();
      const featureChip = getByLabelText("Feature request");
      await fireEvent.press(featureChip);
      // Verify it's now selected (aria state)
      expect(featureChip.props.accessibilityState?.selected).toBe(true);
    });
  });
});
