/**
 * The adapter used where there is no store to talk to: web builds and store
 * builds where the premium games are hidden (v1.0). Every call reports
 * `store_unavailable`; nothing is ever granted.
 */
import type { PurchaseAdapter, RestoreResult } from "./types";

const unavailableRestore = (): RestoreResult => ({
  restored: [],
  alreadyOwned: [],
  pending: [],
  error: "store_unavailable",
});

export const unavailablePurchaseAdapter: PurchaseAdapter = {
  init: async () => {},
  dispose: async () => {},
  getProducts: async () => [],
  purchase: async () => ({ kind: "error", code: "store_unavailable", retryable: false }),
  restore: async () => unavailableRestore(),
  syncOwned: async () => unavailableRestore(),
  onTransaction: () => () => {},
};
