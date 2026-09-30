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

export interface PremiumProduct {
  /** `game_types.name` / the slug used by `PREMIUM_GAMES` and `HIDDEN_GAMES`. */
  gameSlug: string;
  /** Store product ID — identical on iOS and Android. */
  productId: string;
}

export const PRODUCT_ID_PREFIX: string = catalog.productIdPrefix;

export const PREMIUM_PRODUCTS: readonly PremiumProduct[] = catalog.products;

const byGame = new Map(PREMIUM_PRODUCTS.map((p) => [p.gameSlug, p.productId]));
const byProduct = new Map(PREMIUM_PRODUCTS.map((p) => [p.productId, p.gameSlug]));

export function productIdForGame(gameSlug: string): string | undefined {
  return byGame.get(gameSlug);
}

export function gameForProductId(productId: string): string | undefined {
  return byProduct.get(productId);
}
