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
 */
import catalog from "./premiumProducts.json";

/** The premium games that have a store product (the slugs in `premiumProducts.json`). */
export type PremiumGameSlug = "blackjack" | "cascade" | "hearts" | "mahjong" | "starswarm";

export interface PremiumProduct {
  /** `game_types.name` / the slug used by `PREMIUM_GAMES` and `HIDDEN_GAMES`. */
  gameSlug: PremiumGameSlug;
  /** Store product ID — identical on iOS and Android. */
  productId: string;
}

export const PRODUCT_ID_PREFIX: string = catalog.productIdPrefix;

// JSON imports widen `gameSlug` to `string`; the unit test pins every entry to
// `PremiumGameSlug` (via `isPremiumGameSlug`), so this assertion is checked.
export const PREMIUM_PRODUCTS: readonly PremiumProduct[] = catalog.products as PremiumProduct[];

const byGame = new Map<string, string>(PREMIUM_PRODUCTS.map((p) => [p.gameSlug, p.productId]));
const byProduct = new Map<string, PremiumGameSlug>(
  PREMIUM_PRODUCTS.map((p) => [p.productId, p.gameSlug])
);

/** Narrows an arbitrary slug (route param, server payload) to a purchasable game. */
export function isPremiumGameSlug(s: string): s is PremiumGameSlug {
  return byGame.has(s);
}

export function productIdForGame(gameSlug: string): string | undefined {
  return byGame.get(gameSlug);
}

export function gameForProductId(productId: string): PremiumGameSlug | undefined {
  return byProduct.get(productId);
}
