/**
 * The premium store catalog (#2785, docs/IAP.md §2) — pure data, no React.
 *
 * One non-consumable product per premium game. The same product ID is used in
 * App Store Connect and Play Console. `premiumProducts.json` is the single
 * source of truth for the game → product mapping: the paywall (#841) and the
 * purchase adapter read it here, and the backend drift test
 * (`backend/tests/test_premium_products.py`) checks it against the
 * `game_types.is_premium` rows so the two cannot diverge.
 *
 * Product IDs can never be reused once created in either store, so an entry is
 * never renamed — only added. This catalog says what *can be bought*; it does
 * not decide visibility (`gameVisibility.ts`) or access (`EntitlementContext`).
 *
 * An entry with `"enabled": false` keeps its game → product mapping (the game
 * is still premium, and the drift tests still see it) but is not sold:
 * `STORE_PRODUCTS` leaves it out, so it is not created in or listed on either
 * store. Cascade is disabled pending its rework (#3001, epic #3033).
 */
import catalog from "./premiumProducts.json";

/** The premium games that have a store product (the slugs in `premiumProducts.json`). */
export type PremiumGameSlug = "blackjack" | "cascade" | "hearts" | "mahjong" | "starswarm";

export interface PremiumProduct {
  /** `game_types.name` / the slug used by `PREMIUM_GAMES` and `HIDDEN_GAMES`. */
  gameSlug: PremiumGameSlug;
  /** Store product ID — identical on iOS and Android. */
  productId: string;
  /** `false` holds the product back from both stores (see `STORE_PRODUCTS`). Default `true`. */
  enabled?: boolean;
}

/** @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126). */
export const PRODUCT_ID_PREFIX: string = catalog.productIdPrefix;

// JSON imports widen `gameSlug` to `string`; the unit test pins every entry to
// `PremiumGameSlug` (via `isPremiumGameSlug`), so this assertion is checked.
export const PREMIUM_PRODUCTS: readonly PremiumProduct[] = catalog.products as PremiumProduct[];

/**
 * The products to create in App Store Connect / Play Console and list in the
 * stores: every catalog entry not marked `"enabled": false`.
 * @internal Exported for tests and store-setup tooling only; no production caller yet (#2874).
 */
export const STORE_PRODUCTS: readonly PremiumProduct[] = PREMIUM_PRODUCTS.filter(
  (p) => p.enabled !== false
);

const byGame = new Map<string, string>(PREMIUM_PRODUCTS.map((p) => [p.gameSlug, p.productId]));

/** Narrows an arbitrary slug (route param, server payload) to a purchasable game. */
export function isPremiumGameSlug(s: string): s is PremiumGameSlug {
  return byGame.has(s);
}
