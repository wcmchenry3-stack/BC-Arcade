/**
 * Settings "Restore Purchases" entry (#841, Apple 3.1.1): present where
 * purchases exist, absent where they do not (web, v1.0 store builds).
 */
import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { ThemeProvider } from "../../theme/ThemeContext";
import SettingsScreen from "../SettingsScreen";
import { PurchaseProvider } from "../../purchases/PurchaseProvider";
import { createFakePurchaseAdapter } from "../../purchases/fakeAdapter";
import type { FakePurchaseConfig } from "../../purchases/fakeAdapter";

jest.mock("../../game/_shared/gameEventClient", () => ({
  gameEventClient: { clearAll: jest.fn() },
}));
jest.mock("../../api/stats", () => ({ statsApi: { deleteMyData: jest.fn() } }));
jest.mock("../../hooks/useMyStats", () => ({ clearMyStatsCache: jest.fn() }));
jest.mock("../../components/LanguageSwitcher", () => ({
  __esModule: true,
  default: "MockLanguageSwitcher",
}));
jest.mock("../../entitlements/EntitlementContext", () => ({
  ...jest.requireActual("../../entitlements/EntitlementContext"),
  useEntitlementGate: () => ({
    canPlay: () => false,
    isLoading: false,
    lastRefreshed: null,
    refresh: jest.fn().mockResolvedValue(undefined),
    applyToken: jest.fn().mockResolvedValue(undefined),
  }),
}));

async function renderSettings(config?: FakePurchaseConfig) {
  const adapter = createFakePurchaseAdapter(config);
  const ui = (
    <ThemeProvider>
      {config ? (
        <PurchaseProvider adapter={adapter}>
          <SettingsScreen />
        </PurchaseProvider>
      ) : (
        <SettingsScreen />
      )}
    </ThemeProvider>
  );
  await render(ui);
  return { adapter };
}

describe("SettingsScreen Restore Purchases", () => {
  it("is hidden when purchases are unavailable (web, v1.0 store builds)", async () => {
    await renderSettings();
    expect(screen.queryByTestId("restore-purchases-button")).toBeNull();
  });

  it("is shown when purchases are available and calls restore", async () => {
    const { adapter } = await renderSettings({});
    const button = screen.getByTestId("restore-purchases-button");
    expect(screen.getAllByText("Restore Purchases").length).toBeGreaterThan(0);
    await fireEvent.press(button);
    await waitFor(() => expect(adapter.calls.restore).toBe(1));
    await waitFor(() => expect(screen.getByTestId("restore-purchases-nothing")).toBeTruthy());
  });

  it("confirms a successful restore", async () => {
    await renderSettings({
      restoreResult: { restored: ["cascade"], alreadyOwned: [], pending: [] },
    });
    await fireEvent.press(screen.getByTestId("restore-purchases-button"));
    await waitFor(() => expect(screen.getByText("Purchases restored.")).toBeTruthy());
  });

  it("reports a failed restore", async () => {
    await renderSettings({
      restoreResult: { restored: [], alreadyOwned: [], pending: [], error: "server_unavailable" },
    });
    await fireEvent.press(screen.getByTestId("restore-purchases-button"));
    await waitFor(() => expect(screen.getByTestId("restore-purchases-error")).toBeTruthy());
  });

  it("has a 48dp target", async () => {
    await renderSettings({});
    const flat = Object.assign(
      {},
      ...[].concat(screen.getByTestId("restore-purchases-button").props.style)
    );
    expect(flat.minHeight).toBeGreaterThanOrEqual(48);
  });
});
