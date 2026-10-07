/**
 * Deterministic `PurchaseAdapter` for Jest, Maestro test builds and dev
 * (docs/IAP.md §9.1). Nothing here talks to a store. Every behavior is set by
 * `FakePurchaseConfig`, and the returned adapter records its calls.
 */
import { PREMIUM_PRODUCTS } from "../entitlements/premiumProducts";
import type {
  PremiumGameSlug,
  PurchaseAdapter,
  PurchaseOutcome,
  RestoreResult,
  StoreProduct,
  TransactionEvent,
} from "./types";

export interface FakePurchaseConfig {
  /** Store products returned by getProducts. Default: every catalog product at "$4.99". */
  products?: StoreProduct[];
  /** Result of purchase(). A function sees the slug. Default: `owned`. */
  purchaseOutcome?: PurchaseOutcome | ((slug: PremiumGameSlug) => PurchaseOutcome);
  /** Result of restore(). Default: nothing to restore. */
  restoreResult?: RestoreResult;
  /** Result of syncOwned(). Default: nothing to sync. */
  syncResult?: RestoreResult;
  /** Make getProducts reject (simulates a store failure). */
  getProductsError?: Error;
  /** Called on every owned outcome / restore, like a real adapter applying the server token. */
  onGrant?: (slugs: PremiumGameSlug[]) => void | Promise<void>;
}

export interface FakePurchaseAdapter extends PurchaseAdapter {
  calls: {
    init: number;
    dispose: number;
    getProducts: PremiumGameSlug[][];
    purchase: PremiumGameSlug[];
    restore: number;
    syncOwned: ReadonlySet<string>[];
  };
  /** Deliver a transaction event to listeners, like an Ask to Buy approval arriving. */
  emit(event: TransactionEvent): void;
  /** Change behavior mid-test. */
  configure(patch: FakePurchaseConfig): void;
}

const FAKE_PRICE = "$4.99";

const nothing = (): RestoreResult => ({ restored: [], alreadyOwned: [], pending: [] });

export function fakeProducts(price: string = FAKE_PRICE): StoreProduct[] {
  return PREMIUM_PRODUCTS.map((p) => ({
    gameSlug: p.gameSlug,
    productId: p.productId,
    displayPrice: price,
    title: p.gameSlug,
    description: `${p.gameSlug} (store description)`,
  }));
}

export function createFakePurchaseAdapter(initial: FakePurchaseConfig = {}): FakePurchaseAdapter {
  let config: FakePurchaseConfig = { ...initial };
  const listeners = new Set<(e: TransactionEvent) => void>();
  const calls: FakePurchaseAdapter["calls"] = {
    init: 0,
    dispose: 0,
    getProducts: [],
    purchase: [],
    restore: 0,
    syncOwned: [],
  };

  return {
    calls,
    async init() {
      calls.init += 1;
    },
    async dispose() {
      calls.dispose += 1;
      listeners.clear();
    },
    async getProducts(slugs) {
      calls.getProducts.push([...slugs]);
      if (config.getProductsError) throw config.getProductsError;
      return (config.products ?? fakeProducts()).filter((p) => slugs.includes(p.gameSlug));
    },
    async purchase(slug) {
      calls.purchase.push(slug);
      const o: PurchaseOutcome | ((s: PremiumGameSlug) => PurchaseOutcome) =
        config.purchaseOutcome ?? { kind: "owned", gameSlug: slug };
      const outcome = typeof o === "function" ? o(slug) : o;
      if (outcome.kind === "owned") await config.onGrant?.([outcome.gameSlug]);
      return outcome;
    },
    async restore() {
      calls.restore += 1;
      const result = config.restoreResult ?? nothing();
      if (result.restored.length > 0) await config.onGrant?.(result.restored);
      return result;
    },
    async syncOwned(entitled) {
      calls.syncOwned.push(entitled);
      const result = config.syncResult ?? nothing();
      if (result.restored.length > 0) await config.onGrant?.(result.restored);
      return result;
    },
    onTransaction(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    emit(event) {
      listeners.forEach((l) => l(event));
    },
    configure(patch) {
      config = { ...config, ...patch };
    },
  };
}
