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

async function renderWidget(
  opts: { visible?: boolean; onClose?: () => void; onSubmitted?: () => void } = {}
) {
  const { visible = true, onClose = jest.fn(), onSubmitted } = opts;
  return await render(
    <ThemeProvider>
      <FeedbackWidget visible={visible} onClose={onClose} onSubmitted={onSubmitted} />
    </ThemeProvider>
  );
}

async function fillAndSubmit(ui: Awaited<ReturnType<typeof renderWidget>>) {
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

    it("renders only the Description field, with no title field", async () => {
      const { getByPlaceholderText, queryByPlaceholderText, queryByText } = await renderWidget();
      expect(queryByPlaceholderText("Brief summary of the issue or idea")).toBeNull();
      expect(queryByText("Title")).toBeNull();
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
    it("shows description error when submitting without a description", async () => {
      const { getByText } = await renderWidget();
      await act(async () => {
        await fireEvent.press(getByText("Submit"));
      });
      expect(getByText("Description is required.")).toBeTruthy();
      expect(mockCaptureFeedback).not.toHaveBeenCalled();
    });
  });

  describe("successful submission", () => {
    it("sends the description alone and closes the sheet without a confirmation step", async () => {
      const onClose = jest.fn();
      const onSubmitted = jest.fn();
      const ui = await renderWidget({ onClose, onSubmitted });
      await fillAndSubmit(ui);

      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
      expect(onSubmitted).toHaveBeenCalledTimes(1);
      expect(ui.queryByText("Thanks for your feedback!")).toBeNull();
      expect(mockCaptureFeedback).toHaveBeenCalledTimes(1);
      expect(mockCaptureFeedback.mock.calls[0][0]).toMatchObject({
        message: "My description",
        tags: { "feedback.type": "bug" },
      });
    });
  });

  describe("error states", () => {
    it("shows the rate limit message once the per-install limit is reached", async () => {
      const hook = await renderHook(() => useFeedbackSubmit());
      for (let i = 0; i < FEEDBACK_RATE_LIMIT_MAX; i++) {
        await act(async () => {
          await hook.result.current.submit({ description: "d", type: "bug" });
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
