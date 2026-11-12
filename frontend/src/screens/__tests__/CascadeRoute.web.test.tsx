/**
 * The Cascade route on web (#2960): CanvasKit loads first, then the screen; a loading state
 * while it downloads, and a readable error with a Retry if it fails (no endless spinner, #2539).
 */
import React from "react";
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import * as Sentry from "@sentry/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";

// Stands in for loadCascadeScreen.web.ts (CanvasKit, then `import()` of the screen, which Jest
// cannot run): resolves to the screen once the test's CanvasKit load settles.
const mockLoadCanvasKit = jest.fn<Promise<void>, []>();
jest.mock("../loadCascadeScreen.web", () => ({
  loadCascadeScreen: async () => {
    await mockLoadCanvasKit();
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("../CascadeScreen").default;
  },
}));

let mockScreenEvaluated = false;
jest.mock("../CascadeScreen", () => {
  mockScreenEvaluated = true;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text: MockText } = require("react-native");
  return { __esModule: true, default: () => <MockText>cascade-screen</MockText> };
});

jest.mock("@react-navigation/native", () => ({
  ...jest.requireActual("@react-navigation/native"),
  useNavigation: () => ({ popToTop: jest.fn(), navigate: jest.fn(), goBack: jest.fn() }),
}));

import CascadeRoute from "../CascadeRoute.web";
import NativeCascadeRoute from "../CascadeRoute";

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function renderRoute() {
  return render(
    <ThemeProvider>
      <CascadeRoute />
    </ThemeProvider>
  );
}

beforeEach(() => {
  mockLoadCanvasKit.mockReset();
  (Sentry.captureException as jest.Mock | undefined)?.mockClear?.();
});

describe("CascadeRoute (web)", () => {
  it("shows a loading state, and does not import the screen, until CanvasKit has loaded", async () => {
    const load = deferred();
    mockLoadCanvasKit.mockReturnValue(load.promise);
    await renderRoute();

    expect(screen.getByTestId("cascade-web-loading")).toBeTruthy();
    expect(screen.getByText("Loading Cascade…")).toBeTruthy();
    expect(screen.queryByText("cascade-screen")).toBeNull();
    expect(mockScreenEvaluated).toBe(false);

    await act(async () => load.resolve());
    expect(await screen.findByText("cascade-screen")).toBeTruthy();
    expect(screen.queryByTestId("cascade-web-loading")).toBeNull();
  });

  it("shows a readable error with Retry when CanvasKit fails, and Retry loads the screen", async () => {
    const error = new Error("wasm fetch failed");
    mockLoadCanvasKit.mockRejectedValueOnce(error);
    await renderRoute();

    expect(await screen.findByTestId("cascade-web-error")).toBeTruthy();
    expect(
      screen.getByText("Cascade couldn't load its graphics. Check your connection and try again.")
    ).toBeTruthy();
    expect(screen.queryByTestId("cascade-web-loading")).toBeNull();
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      tags: { subsystem: "cascade.canvaskit" },
    });

    mockLoadCanvasKit.mockResolvedValueOnce();
    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByText("cascade-screen")).toBeTruthy();
    expect(mockLoadCanvasKit).toHaveBeenCalledTimes(2);
  });

  it("keeps the error up when Retry fails again", async () => {
    mockLoadCanvasKit.mockRejectedValue(new Error("offline"));
    await renderRoute();
    await screen.findByTestId("cascade-web-error");

    await fireEvent.press(screen.getByText("Try again"));
    expect(await screen.findByTestId("cascade-web-error")).toBeTruthy();
    expect(mockLoadCanvasKit).toHaveBeenCalledTimes(2);
  });

  it("ignores a load that settles after the route unmounts", async () => {
    const load = deferred();
    mockLoadCanvasKit.mockReturnValue(load.promise);
    const { unmount } = await renderRoute();
    await unmount();
    await act(async () => load.reject(new Error("late")));
    expect(screen.queryByTestId("cascade-web-error")).toBeNull();
  });
});

describe("CascadeRoute (iOS and Android)", () => {
  it("is the Cascade screen itself", async () => {
    await render(<NativeCascadeRoute />);
    expect(screen.getByText("cascade-screen")).toBeTruthy();
    expect(mockLoadCanvasKit).not.toHaveBeenCalled();
  });
});
