/**
 * PaywallScreen (#841): rendered with the fake PurchaseAdapter, so no store
 * library is involved. Covers the price, the always-visible Restore Purchases
 * button (Apple 3.1.1) and every purchase / restore outcome state.
 */
import React from "react";
import { Linking } from "react-native";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import PaywallScreen from "../PaywallScreen";
import { ThemeProvider } from "../../theme/ThemeContext";
import { PurchaseProvider } from "../../purchases/PurchaseProvider";
import { createFakePurchaseAdapter, fakeProducts } from "../../purchases/fakeAdapter";
import type { FakePurchaseAdapter, FakePurchaseConfig } from "../../purchases/fakeAdapter";
import { PRIVACY_POLICY_URL, SUPPORT_URL, TERMS_OF_SERVICE_URL } from "../../config/legal";

const mockNavigate = jest.fn();
const mockGoBack = jest.fn();
let mockParams: { gameSlug?: string } = { gameSlug: "cascade" };
jest.mock("@react-navigation/native", () =>
  mockScreenDeps().mockNavigation(() => ({ navigate: mockNavigate, goBack: mockGoBack }), {
    actual: true,
    useRoute: () => ({ params: mockParams }),
  })
);

let mockEntitled = new Set<string>();
let mockLoading = false;
// Stable identities: a fresh fn per render would re-run PurchaseProvider's effect and dispose the adapter.
const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockApplyToken = jest.fn().mockResolvedValue(undefined);
jest.mock("../../entitlements/EntitlementContext", () => ({
  ...jest.requireActual("../../entitlements/EntitlementContext"),
  useEntitlementGate: () => ({
    canPlay: (slug: string) => mockEntitled.has(slug),
    isLoading: mockLoading,
    lastRefreshed: null,
    refresh: mockRefresh,
    applyToken: mockApplyToken,
  }),
}));
jest.mock("../../components/shared/AppHeader", () => ({
  APP_HEADER_HEIGHT: 64,
  AppHeader: ({ title }: { title: string }) => {
    const { Text } = jest.requireActual("react-native");
    return <Text accessibilityRole="header">{title}</Text>;
  },
}));

const insets = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, bottom: 34, left: 0, right: 0 },
};

let adapter: FakePurchaseAdapter;

async function renderPaywall(
  config: FakePurchaseConfig = {},
  setup?: (a: FakePurchaseAdapter) => void
) {
  adapter = createFakePurchaseAdapter(config);
  setup?.(adapter);
  const utils = await render(
    <SafeAreaProvider initialMetrics={insets}>
      <ThemeProvider>
        <PurchaseProvider adapter={adapter}>
          <PaywallScreen />
        </PurchaseProvider>
      </ThemeProvider>
    </SafeAreaProvider>
  );
  // let getProducts settle
  await act(async () => {});
  return utils;
}

const cascadeNav = {
  screen: "Lobby",
  params: { screen: "Cascade" },
};

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { gameSlug: "cascade" };
  mockEntitled = new Set();
  mockLoading = false;
  jest.spyOn(Linking, "openURL").mockResolvedValue(true);
});

describe("PaywallScreen content", () => {
  it("shows the game name, description, the store's price, Buy and Restore Purchases", async () => {
    await renderPaywall();
    expect(screen.getByTestId("paywall-game-name")).toHaveTextContent("Cascade");
    expect(screen.getByTestId("paywall-description")).toBeTruthy();
    expect(screen.getByText("Buy for $4.99")).toBeTruthy();
    expect(screen.getByTestId("paywall-buy")).toBeEnabled();
    expect(screen.getByTestId("paywall-restore")).toBeTruthy();
    expect(screen.getByText("Restore Purchases")).toBeTruthy();
    expect(screen.getByText(/One-time purchase/)).toBeTruthy();
    expect(screen.getByText(/Unlimited replay/)).toBeTruthy();
    expect(screen.getByTestId("paywall-terms")).toBeTruthy();
    expect(screen.getByTestId("paywall-privacy")).toBeTruthy();
  });

  it("Terms and Privacy links open the hosted legal pages with localized labels", async () => {
    await renderPaywall();
    const terms = screen.getByTestId("paywall-terms");
    const privacy = screen.getByTestId("paywall-privacy");
    expect(terms).toHaveTextContent("Terms of Service");
    expect(privacy).toHaveTextContent("Privacy Policy");
    await fireEvent.press(terms);
    expect(Linking.openURL).toHaveBeenCalledWith(TERMS_OF_SERVICE_URL);
    await fireEvent.press(privacy);
    expect(Linking.openURL).toHaveBeenCalledWith(PRIVACY_POLICY_URL);
  });

  it("displays the localized price from the store, never a hardcoded one", async () => {
    await renderPaywall({ products: fakeProducts("5,49 €") });
    expect(screen.getByText("Buy for 5,49 €")).toBeTruthy();
    expect(screen.queryByText(/\$4\.99/)).toBeNull();
  });

  it("asks the adapter only for this game's product", async () => {
    await renderPaywall();
    expect(adapter.calls.getProducts).toEqual([["cascade"]]);
  });

  it("uses no lives / continues / chips wording", async () => {
    await renderPaywall();
    const all = JSON.stringify(screen.toJSON());
    expect(all).not.toMatch(/\b(lives|continues|chips)\b/i);
  });

  it("gives Buy and Restore at least a 48dp touch target", async () => {
    await renderPaywall();
    for (const id of ["paywall-buy", "paywall-restore"]) {
      const flat = Object.assign({}, ...[].concat(screen.getByTestId(id).props.style));
      expect(flat.minHeight).toBeGreaterThanOrEqual(48);
    }
  });

  it("has a Buy button labelled with the game and price for screen readers", async () => {
    await renderPaywall();
    expect(screen.getByLabelText("Buy Cascade for $4.99")).toBeTruthy();
  });

  it("shows a loading state and a disabled Buy until the price arrives", async () => {
    let release: (p: ReturnType<typeof fakeProducts>) => void = () => {};
    adapter = createFakePurchaseAdapter();
    adapter.getProducts = () => new Promise((resolve) => (release = resolve));
    await render(
      <SafeAreaProvider initialMetrics={insets}>
        <ThemeProvider>
          <PurchaseProvider adapter={adapter}>
            <PaywallScreen />
          </PurchaseProvider>
        </ThemeProvider>
      </SafeAreaProvider>
    );
    expect(screen.getByText("Loading price…")).toBeTruthy();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(screen.getByTestId("paywall-restore")).toBeTruthy();
    await act(async () => release(fakeProducts()));
    expect(screen.getByText("Buy for $4.99")).toBeTruthy();
  });

  it("disables Buy and explains when the product is not in the store", async () => {
    await renderPaywall({ products: [] });
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(screen.getByTestId("paywall-unavailable")).toBeTruthy();
    expect(screen.getByTestId("paywall-restore")).toBeTruthy();
  });

  it("offers a reload when the store products fail to load", async () => {
    await renderPaywall({ getProductsError: new Error("store down") });
    expect(screen.getByTestId("paywall-load-error")).toBeTruthy();
    adapter.configure({ getProductsError: undefined });
    await fireEvent.press(screen.getByTestId("paywall-reload"));
    await waitFor(() => expect(screen.getByText("Buy for $4.99")).toBeTruthy());
  });

  it("says the store is unavailable with the default (unavailable) adapter", async () => {
    await render(
      <SafeAreaProvider initialMetrics={insets}>
        <ThemeProvider>
          <PaywallScreen />
        </ThemeProvider>
      </SafeAreaProvider>
    );
    await act(async () => {});
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(screen.getByText("The store isn't available on this device.")).toBeTruthy();
  });

  it("shows a safe message for an unknown game slug", async () => {
    mockParams = { gameSlug: "yacht" };
    await renderPaywall();
    expect(screen.getByTestId("paywall-invalid")).toBeTruthy();
    expect(screen.queryByTestId("paywall-buy")).toBeNull();
    expect(adapter.calls.getProducts).toEqual([]);
  });
});

describe("PaywallScreen purchase outcomes", () => {
  it("owned: opens the game", async () => {
    await renderPaywall();
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("MainTabs", cascadeNav));
    expect(adapter.calls.purchase).toEqual(["cascade"]);
  });

  it("owned: a multi-route game opens its entry route", async () => {
    mockParams = { gameSlug: "blackjack" };
    await renderPaywall();
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith("MainTabs", {
        screen: "Lobby",
        params: { screen: "BlackjackBetting" },
      })
    );
  });

  it("cancelled: stays on the paywall with no message and Buy still available", async () => {
    await renderPaywall({ purchaseOutcome: { kind: "cancelled" } });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(adapter.calls.purchase).toHaveLength(1));
    expect(screen.queryByTestId(/paywall-notice/)).toBeNull();
    expect(screen.getByTestId("paywall-buy")).toBeEnabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("pending (Ask to Buy): shows 'Waiting for approval' and does not grant access", async () => {
    await renderPaywall({ purchaseOutcome: { kind: "pending", gameSlug: "cascade" } });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(screen.getByTestId("paywall-notice-pending")).toBeTruthy());
    expect(screen.getByText(/Waiting for approval/)).toBeTruthy();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("awaiting_server: says it unlocks when back online", async () => {
    await renderPaywall({ purchaseOutcome: { kind: "awaiting_server", gameSlug: "cascade" } });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(screen.getByTestId("paywall-notice-awaiting_server")).toBeTruthy());
    expect(screen.getByText(/unlocks when you're back online/)).toBeTruthy();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("not_linkable: tells the player to contact support and links to it", async () => {
    await renderPaywall({
      purchaseOutcome: { kind: "error", code: "not_linkable", retryable: false },
    });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(screen.getByTestId("paywall-notice-error")).toBeTruthy());
    expect(screen.getByText(/can't be used here/)).toBeTruthy();
    await fireEvent.press(screen.getByTestId("paywall-support"));
    expect(Linking.openURL).toHaveBeenCalledWith(SUPPORT_URL);
    expect(screen.queryByTestId("paywall-retry")).toBeNull();
  });

  it("retryable error: shows the error and lets the player try again", async () => {
    let attempt = 0;
    await renderPaywall({
      purchaseOutcome: (slug) =>
        ++attempt === 1
          ? { kind: "error", code: "server_unavailable", retryable: true }
          : { kind: "owned", gameSlug: slug },
    });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() =>
      expect(screen.getByText("Something went wrong. Please try again.")).toBeTruthy()
    );
    await fireEvent.press(screen.getByTestId("paywall-retry"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("MainTabs", cascadeNav));
    expect(adapter.calls.purchase).toHaveLength(2);
  });

  it("non-retryable error: no retry, Buy disabled, support wording", async () => {
    await renderPaywall({
      purchaseOutcome: { kind: "error", code: "verification_failed", retryable: false },
    });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(screen.getByTestId("paywall-notice-error")).toBeTruthy());
    expect(screen.getByText(/couldn't be completed/)).toBeTruthy();
    expect(screen.queryByTestId("paywall-retry")).toBeNull();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(screen.getByTestId("paywall-support")).toBeTruthy();
  });

  it("an adapter that throws is reported as a retryable error", async () => {
    await renderPaywall();
    adapter.purchase = () => Promise.reject(new Error("boom"));
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(screen.getByTestId("paywall-retry")).toBeTruthy());
  });
});

describe("PaywallScreen in-flight purchase", () => {
  it("is busy while purchasing: Buy and Restore disabled, then re-enabled", async () => {
    await renderPaywall();
    let release: (o: unknown) => void = () => {};
    adapter.purchase = jest.fn(() => new Promise((r) => (release = r as never))) as never;
    await act(async () => {
      fireEvent.press(screen.getByTestId("paywall-buy"));
    });
    expect(adapter.purchase).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("paywall-purchasing")).toBeTruthy();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
    expect(screen.getByTestId("paywall-restore")).toBeDisabled();
    await act(async () => release({ kind: "cancelled" }));
    expect(screen.getByTestId("paywall-buy")).toBeEnabled();
  });

  it("ignores a double tap: two presses in one act() start one purchase", async () => {
    await renderPaywall();
    let release: (o: unknown) => void = () => {};
    adapter.purchase = jest.fn(() => new Promise((r) => (release = r as never))) as never;
    await act(async () => {
      fireEvent.press(screen.getByTestId("paywall-buy"));
      fireEvent.press(screen.getByTestId("paywall-buy"));
    });
    expect(adapter.purchase).toHaveBeenCalledTimes(1);
    await act(async () => release({ kind: "cancelled" }));
  });

  it("keeps Buy disabled while the entitlement bootstrap is still loading", async () => {
    mockLoading = true;
    await renderPaywall();
    expect(screen.getByText("Buy for $4.99")).toBeTruthy();
    expect(screen.getByTestId("paywall-buy")).toBeDisabled();
  });

  it("clears a pending notice when the adapter reports a failed transaction for this game", async () => {
    await renderPaywall({ purchaseOutcome: { kind: "pending", gameSlug: "cascade" } });
    await fireEvent.press(screen.getByTestId("paywall-buy"));
    await waitFor(() => expect(screen.getByTestId("paywall-notice-pending")).toBeTruthy());
    // another game's failure is ignored
    await act(async () =>
      adapter.emit({ kind: "error", gameSlug: "hearts", code: "verification_failed" })
    );
    expect(screen.getByTestId("paywall-notice-pending")).toBeTruthy();
    await act(async () =>
      adapter.emit({ kind: "error", gameSlug: "cascade", code: "verification_failed" })
    );
    expect(screen.queryByTestId("paywall-notice-pending")).toBeNull();
    expect(screen.getByTestId("paywall-buy")).toBeEnabled();
  });

  it("unsubscribes its transaction listener on unmount", async () => {
    let active = 0;
    const { unmount } = await renderPaywall({}, (a) => {
      const orig = a.onTransaction.bind(a);
      a.onTransaction = (l) => {
        active += 1;
        const off = orig(l);
        return () => {
          active -= 1;
          off();
        };
      };
    });
    // PurchaseProvider and the paywall each subscribe
    expect(active).toBe(2);
    await unmount();
    expect(active).toBe(0);
  });
});

describe("PaywallScreen already owned", () => {
  it("goes straight to the game when the player already owns it", async () => {
    mockEntitled = new Set(["cascade"]);
    await renderPaywall();
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("MainTabs", cascadeNav));
    expect(screen.getByTestId("paywall-owned")).toBeTruthy();
    expect(screen.queryByTestId("paywall-buy")).toBeNull();
    expect(mockNavigate).toHaveBeenCalledTimes(1);
  });

  it("offers a Play button on the owned view", async () => {
    mockEntitled = new Set(["cascade"]);
    await renderPaywall();
    expect(screen.getByTestId("paywall-play")).toBeTruthy();
  });
});

describe("PaywallScreen restore", () => {
  it("is visible and calls the adapter's restore", async () => {
    await renderPaywall();
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(adapter.calls.restore).toBe(1));
  });

  it("restoring this game opens it", async () => {
    await renderPaywall({
      restoreResult: { restored: ["cascade"], alreadyOwned: [], pending: [] },
    });
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("MainTabs", cascadeNav));
  });

  it("this game already owned on the store account also opens it", async () => {
    await renderPaywall({
      restoreResult: { restored: [], alreadyOwned: ["cascade"], pending: [] },
    });
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(mockNavigate).toHaveBeenCalledWith("MainTabs", cascadeNav));
  });

  it("restoring only other games confirms and stays on the paywall", async () => {
    await renderPaywall({
      restoreResult: { restored: ["hearts"], alreadyOwned: [], pending: [] },
    });
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(screen.getByTestId("paywall-restore-restored")).toBeTruthy());
    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it("says so when there is nothing to restore", async () => {
    await renderPaywall();
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(screen.getByTestId("paywall-restore-nothing")).toBeTruthy());
    expect(screen.getByText("No purchases to restore for this store account.")).toBeTruthy();
  });

  it("reports a pending approval found by restore", async () => {
    await renderPaywall({
      restoreResult: { restored: [], alreadyOwned: [], pending: ["cascade"] },
    });
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(screen.getByTestId("paywall-restore-pending")).toBeTruthy());
  });

  it("reports a restore error", async () => {
    await renderPaywall({
      restoreResult: { restored: [], alreadyOwned: [], pending: [], error: "server_unavailable" },
    });
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(screen.getByTestId("paywall-restore-error")).toBeTruthy());
  });

  it("reports an error when the adapter throws during restore", async () => {
    await renderPaywall();
    adapter.restore = () => Promise.reject(new Error("boom"));
    await fireEvent.press(screen.getByTestId("paywall-restore"));
    await waitFor(() => expect(screen.getByTestId("paywall-restore-error")).toBeTruthy());
  });
});
