/**
 * Picks the `PurchaseAdapter` for this build.
 *
 * Extension point for #2786 / #2787: call `registerPurchaseAdapterFactory`
 * once (from the module that owns `expoIapAdapter`, imported by `App.tsx`)
 * with a factory that builds the real adapter. Until then, and always on web
 * and in builds where every premium game is hidden (v1.0 store builds), the
 * selector returns `unavailablePurchaseAdapter`, so no purchase can start.
 */
import { Platform } from "react-native";
import { visiblePremiumRoutes } from "../entitlements/premiumRoutes";
import type { PurchaseAdapter, PurchaseAdapterDeps, PurchaseAdapterFactory } from "./types";
import { unavailablePurchaseAdapter } from "./unavailableAdapter";

let registered: PurchaseAdapterFactory | null = null;

export function registerPurchaseAdapterFactory(factory: PurchaseAdapterFactory | null): void {
  registered = factory;
}

export function selectPurchaseAdapter(deps: PurchaseAdapterDeps): PurchaseAdapter {
  if (!registered) return unavailablePurchaseAdapter;
  if (Platform.OS === "web") return unavailablePurchaseAdapter;
  // Store builds hide every premium game (gameVisibility.ts): never sell one.
  if (visiblePremiumRoutes().length === 0) return unavailablePurchaseAdapter;
  return registered(deps);
}
