/**
 * The purchase surface the UI is allowed to use (docs/IAP.md §9.2).
 *
 * The UI never imports the store library (`expo-iap`); it talks to a
 * `PurchaseAdapter`. The real adapter (#2786 iOS / #2787 Android) implements
 * this interface; `fakeAdapter.ts` and `unavailableAdapter.ts` are the two
 * that ship with the paywall (#841).
 */
import type { PremiumGameSlug } from "../entitlements/premiumProducts";

export type { PremiumGameSlug };

export interface StoreProduct {
  gameSlug: PremiumGameSlug;
  productId: string;
  /** Localized, store-formatted price. Always display this; never hardcode prices. */
  displayPrice: string;
  title: string;
  description: string;
}

export type PurchaseErrorCode =
  | "store_unavailable" // store not connected, billing unavailable, not signed in
  | "product_unavailable" // product not found / not approved yet
  | "verification_failed" // server 400/422
  | "not_linkable" // server 403 ownership_mismatch / 409 link_limit — finished; show "contact support"
  | "server_unavailable" // server 5xx / network — purchase is safe, will retry
  | "unknown";

export type PurchaseOutcome =
  | { kind: "owned"; gameSlug: PremiumGameSlug } // verified, persisted, finished
  | { kind: "pending"; gameSlug: PremiumGameSlug } // Ask to Buy / pending payment
  | { kind: "awaiting_server"; gameSlug: PremiumGameSlug } // charged; server not reached yet
  | { kind: "cancelled" }
  | { kind: "error"; code: PurchaseErrorCode; retryable: boolean };

export interface RestoreResult {
  /** Newly linked to this session. */
  restored: PremiumGameSlug[];
  /** Already in `entitled_games`. */
  alreadyOwned: PremiumGameSlug[];
  pending: PremiumGameSlug[];
  /** Set when the restore could not complete. */
  error?: PurchaseErrorCode;
}

export type TransactionEvent =
  | { kind: "owned"; gameSlug: PremiumGameSlug }
  | { kind: "pending"; gameSlug: PremiumGameSlug }
  | { kind: "revoked"; gameSlug: PremiumGameSlug }
  | { kind: "error"; gameSlug?: PremiumGameSlug; code: PurchaseErrorCode };

export interface PurchaseAdapter {
  /** Connect to the store, start the transaction listener, process unfinished transactions. Idempotent. */
  init(): Promise<void>;
  dispose(): Promise<void>;
  /** Store products for the catalog; missing products are omitted, not thrown. */
  getProducts(slugs: readonly PremiumGameSlug[]): Promise<StoreProduct[]>;
  /** Full purchase: store sheet → server verification → finish. Never resolves "owned" before the server says so. */
  purchase(slug: PremiumGameSlug): Promise<PurchaseOutcome>;
  /** User-initiated restore (may show a store sign-in prompt on iOS). */
  restore(): Promise<RestoreResult>;
  /** Silent: post store-owned products missing from `entitled`. Never prompts. */
  syncOwned(entitled: ReadonlySet<string>): Promise<RestoreResult>;
  /** Transactions arriving outside a purchase() call (Ask to Buy approval, interrupted, other device). */
  onTransaction(listener: (e: TransactionEvent) => void): () => void;
}

/**
 * What a real adapter needs from the app. After any `owned` outcome, event or
 * restore the adapter calls `applyToken` with the server's `entitlements`
 * token so `canPlay` updates at once (docs/IAP.md §9.2).
 */
export interface PurchaseAdapterDeps {
  applyToken: (rawToken: string) => Promise<void>;
}

export type PurchaseAdapterFactory = (deps: PurchaseAdapterDeps) => PurchaseAdapter;
