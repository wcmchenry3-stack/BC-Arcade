/**
 * The purchase layer (#841, docs/IAP.md §9): unavailable + fake adapters, the
 * adapter selector and the PurchaseProvider lifecycle.
 */
import React from "react";
import { act, render, renderHook } from "@testing-library/react-native";
import { createFakePurchaseAdapter, fakeProducts } from "../fakeAdapter";
import { PurchaseProvider, usePurchases } from "../PurchaseProvider";
import { registerPurchaseAdapterFactory, selectPurchaseAdapter } from "../selectAdapter";
import { unavailablePurchaseAdapter } from "../unavailableAdapter";
import { __forceStoreBuildForTests } from "../../entitlements/gameVisibility";

const mockRefresh = jest.fn().mockResolvedValue(undefined);
const mockApplyToken = jest.fn().mockResolvedValue(undefined);
let mockLoading = false;
let mockEntitled = new Set<string>();
jest.mock("../../entitlements/EntitlementContext", () => ({
  ...jest.requireActual("../../entitlements/EntitlementContext"),
  useEntitlements: () => ({
    canPlay: (slug: string) => mockEntitled.has(slug),
    isLoading: mockLoading,
    lastRefreshed: null,
    refresh: mockRefresh,
    applyToken: mockApplyToken,
  }),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockLoading = false;
  mockEntitled = new Set();
  registerPurchaseAdapterFactory(null);
  __forceStoreBuildForTests(false);
});

afterEach(() => {
  registerPurchaseAdapterFactory(null);
  __forceStoreBuildForTests(false);
});

describe("unavailablePurchaseAdapter", () => {
  it("reports the store as unavailable for every call and grants nothing", async () => {
    const a = unavailablePurchaseAdapter;
    await expect(a.init()).resolves.toBeUndefined();
    await expect(a.getProducts(["cascade"])).resolves.toEqual([]);
    await expect(a.purchase("cascade")).resolves.toEqual({
      kind: "error",
      code: "store_unavailable",
      retryable: false,
    });
    await expect(a.restore()).resolves.toMatchObject({
      restored: [],
      alreadyOwned: [],
      error: "store_unavailable",
    });
    await expect(a.syncOwned(new Set())).resolves.toMatchObject({ error: "store_unavailable" });
    const off = a.onTransaction(() => {});
    expect(typeof off).toBe("function");
    await expect(a.dispose()).resolves.toBeUndefined();
  });
});

describe("fakePurchaseAdapter", () => {
  it("returns catalog products with a configurable price, filtered by slug", async () => {
    const a = createFakePurchaseAdapter({ products: fakeProducts("¥600") });
    const products = await a.getProducts(["hearts", "cascade"]);
    expect(products.map((p) => p.gameSlug).sort()).toEqual(["cascade", "hearts"]);
    expect(products.every((p) => p.displayPrice === "¥600")).toBe(true);
    expect(a.calls.getProducts).toEqual([["hearts", "cascade"]]);
  });

  it("buys successfully by default and calls onGrant", async () => {
    const onGrant = jest.fn();
    const a = createFakePurchaseAdapter({ onGrant });
    await expect(a.purchase("mahjong")).resolves.toEqual({ kind: "owned", gameSlug: "mahjong" });
    expect(onGrant).toHaveBeenCalledWith(["mahjong"]);
  });

  it("does not grant for non-owned outcomes", async () => {
    const onGrant = jest.fn();
    const a = createFakePurchaseAdapter({ purchaseOutcome: { kind: "cancelled" }, onGrant });
    await expect(a.purchase("mahjong")).resolves.toEqual({ kind: "cancelled" });
    expect(onGrant).not.toHaveBeenCalled();
  });

  it("delivers emitted transactions to listeners until unsubscribed", () => {
    const a = createFakePurchaseAdapter();
    const listener = jest.fn();
    const off = a.onTransaction(listener);
    a.emit({ kind: "pending", gameSlug: "hearts" });
    off();
    a.emit({ kind: "owned", gameSlug: "hearts" });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith({ kind: "pending", gameSlug: "hearts" });
  });

  it("returns configured restore/sync results and records calls", async () => {
    const restoreResult = { restored: ["cascade" as const], alreadyOwned: [], pending: [] };
    const a = createFakePurchaseAdapter({ restoreResult, syncResult: restoreResult });
    await expect(a.restore()).resolves.toBe(restoreResult);
    await expect(a.syncOwned(new Set(["hearts"]))).resolves.toBe(restoreResult);
    expect(a.calls.restore).toBe(1);
    expect(a.calls.syncOwned).toEqual([new Set(["hearts"])]);
  });
});

describe("selectPurchaseAdapter", () => {
  const deps = { applyToken: async () => {} };

  it("is the unavailable adapter until a real one is registered", () => {
    expect(selectPurchaseAdapter(deps)).toBe(unavailablePurchaseAdapter);
  });

  it("returns the registered adapter, built with the app's applyToken", () => {
    const fake = createFakePurchaseAdapter();
    const factory = jest.fn(() => fake);
    registerPurchaseAdapterFactory(factory);
    expect(selectPurchaseAdapter(deps)).toBe(fake);
    expect(factory).toHaveBeenCalledWith(deps);
  });

  it("stays unavailable in a store build, where every premium game is hidden", () => {
    registerPurchaseAdapterFactory(() => createFakePurchaseAdapter());
    __forceStoreBuildForTests(true);
    expect(selectPurchaseAdapter(deps)).toBe(unavailablePurchaseAdapter);
  });
});

describe("PurchaseProvider", () => {
  const wrap = (adapter?: ReturnType<typeof createFakePurchaseAdapter>) =>
    function Wrapper({ children }: { children: React.ReactNode }) {
      return <PurchaseProvider adapter={adapter}>{children}</PurchaseProvider>;
    };

  it("defaults to the unavailable adapter, with no provider and with an empty registry", async () => {
    expect((await renderHook(() => usePurchases())).result.current).toEqual({
      adapter: unavailablePurchaseAdapter,
      isAvailable: false,
    });
    const { result } = await renderHook(() => usePurchases(), { wrapper: wrap() });
    expect(result.current.isAvailable).toBe(false);
  });

  it("inits the adapter, runs the silent sync once entitlements load, and disposes on unmount", async () => {
    mockEntitled = new Set(["hearts"]);
    const adapter = createFakePurchaseAdapter();
    const { unmount } = await render(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(adapter.calls.init).toBe(1);
    expect(adapter.calls.syncOwned).toEqual([new Set(["hearts"])]);
    await unmount();
    expect(adapter.calls.dispose).toBe(1);
  });

  it("waits for entitlements to load before syncing", async () => {
    mockLoading = true;
    const adapter = createFakePurchaseAdapter();
    await render(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(adapter.calls.syncOwned).toEqual([]);
  });

  it("re-reads entitlements when a transaction is granted or revoked outside the paywall", async () => {
    const adapter = createFakePurchaseAdapter();
    await render(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    await act(async () => adapter.emit({ kind: "owned", gameSlug: "cascade" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
    await act(async () => adapter.emit({ kind: "pending", gameSlug: "cascade" }));
    expect(mockRefresh).toHaveBeenCalledTimes(1);
  });

  it("does not sync until init() has completed", async () => {
    const adapter = createFakePurchaseAdapter();
    let finishInit: () => void = () => {};
    adapter.init = jest.fn(() => new Promise<void>((r) => (finishInit = r)));
    await render(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(adapter.calls.syncOwned).toEqual([]);
    await act(async () => finishInit());
    expect(adapter.calls.syncOwned).toHaveLength(1);
  });

  it("retries a failed silent sync instead of marking it done", async () => {
    const adapter = createFakePurchaseAdapter();
    const real = adapter.syncOwned.bind(adapter);
    let calls = 0;
    adapter.syncOwned = jest.fn((entitled: ReadonlySet<string>) =>
      ++calls === 1 ? Promise.reject(new Error("offline")) : real(entitled)
    );
    mockEntitled = new Set();
    const { rerender } = await render(
      <PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>
    );
    await act(async () => {});
    expect(calls).toBe(1);
    // entitlements change (e.g. foreground refresh) -> effect re-runs -> retried
    mockEntitled = new Set(["hearts"]);
    await rerender(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(calls).toBe(2);
    // ...and once it succeeded it is not repeated
    mockEntitled = new Set(["hearts", "cascade"]);
    await rerender(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(calls).toBe(2);
  });

  it("does not sync until init() has completed", async () => {
    const adapter = createFakePurchaseAdapter();
    let finishInit: () => void = () => {};
    adapter.init = jest.fn(() => new Promise<void>((r) => (finishInit = r)));
    await render(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(adapter.calls.syncOwned).toEqual([]);
    await act(async () => finishInit());
    expect(adapter.calls.syncOwned).toHaveLength(1);
  });

  it("retries a failed silent sync instead of marking it done", async () => {
    const adapter = createFakePurchaseAdapter();
    const real = adapter.syncOwned.bind(adapter);
    let calls = 0;
    adapter.syncOwned = jest.fn((entitled: ReadonlySet<string>) =>
      ++calls === 1 ? Promise.reject(new Error("offline")) : real(entitled)
    );
    const { rerender } = await render(
      <PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>
    );
    await act(async () => {});
    expect(calls).toBe(1);
    // entitlements change (e.g. a foreground refresh) -> effect re-runs -> retried
    mockEntitled = new Set(["hearts"]);
    await rerender(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(calls).toBe(2);
    // once it has succeeded it is not repeated
    mockEntitled = new Set(["hearts", "cascade"]);
    await rerender(<PurchaseProvider adapter={adapter}>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(calls).toBe(2);
  });

  it("does not init or sync the unavailable adapter", async () => {
    const init = jest.spyOn(unavailablePurchaseAdapter, "init");
    const sync = jest.spyOn(unavailablePurchaseAdapter, "syncOwned");
    await render(<PurchaseProvider>{null}</PurchaseProvider>);
    await act(async () => {});
    expect(init).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });
});
