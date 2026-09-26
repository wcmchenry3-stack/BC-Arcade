import React from "react";
import { render, screen } from "@testing-library/react-native";
import {
  ConnectedOfflineBanner as OfflineBanner,
  OfflineBanner as PlainBanner,
} from "../OfflineBanner";
import * as NetworkContext from "../../../game/_shared/NetworkContext";

jest.mock("../../../theme/ThemeContext", () => ({
  useTheme: () => ({
    colors: { textMuted: "#666", text: "#fff", surfaceAlt: "#222", border: "#333" },
    theme: "dark",
    toggle: jest.fn(),
  }),
}));

// Avoid importing real NetworkContext (which pulls NetInfo + cascade handler).
jest.mock("../../../game/_shared/NetworkContext", () => ({
  useNetwork: jest.fn(),
}));

const useNetworkMock = NetworkContext.useNetwork as jest.Mock;

describe("ConnectedOfflineBanner", () => {
  it("renders nothing when network state is not yet initialized", async () => {
    useNetworkMock.mockReturnValue({ isOnline: false, isInitialized: false });
    await render(<OfflineBanner />);
    expect(screen.queryByText(/Offline/i)).toBeNull();
  });

  it("renders nothing when online", async () => {
    useNetworkMock.mockReturnValue({ isOnline: true, isInitialized: true });
    await render(<OfflineBanner />);
    expect(screen.queryByText(/Offline/i)).toBeNull();
  });

  it("renders banner text when initialized and offline", async () => {
    useNetworkMock.mockReturnValue({ isOnline: false, isInitialized: true });
    await render(<OfflineBanner />);
    expect(screen.getByText(/Offline/i)).toBeTruthy();
  });
});

describe("OfflineBanner", () => {
  it("shows the default offline message", async () => {
    await render(<PlainBanner />);
    expect(screen.getByText(/Offline/i)).toBeTruthy();
  });

  it("shows a custom message when given", async () => {
    await render(<PlainBanner message="Scores will sync later" />);
    expect(screen.getByText("Scores will sync later")).toBeTruthy();
  });
});
