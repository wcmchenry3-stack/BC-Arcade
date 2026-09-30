/**
 * premiumProducts (#2785) — the store catalog must cover exactly the premium
 * games, with one store-valid product ID per game. The backend half of this
 * guard is backend/tests/test_premium_products.py (game_types.is_premium).
 */
import { PREMIUM_GAMES } from "../EntitlementContext";
import { HIDDEN_GAMES } from "../gameVisibility";
import {
  PREMIUM_PRODUCTS,
  PRODUCT_ID_PREFIX,
  gameForProductId,
  productIdForGame,
} from "../premiumProducts";

const slugs = () => new Set(PREMIUM_PRODUCTS.map((p) => p.gameSlug));

describe("premiumProducts", () => {
  it("has one product for every premium game and nothing else", () => {
    expect(slugs()).toEqual(PREMIUM_GAMES);
    expect(PREMIUM_PRODUCTS).toHaveLength(PREMIUM_GAMES.size);
  });

  it("covers every game hidden in v1.0 store builds", () => {
    expect(slugs()).toEqual(HIDDEN_GAMES);
  });

  it("uses the shared product-ID convention, valid on both stores", () => {
    for (const { gameSlug, productId } of PREMIUM_PRODUCTS) {
      expect(productId).toBe(`${PRODUCT_ID_PREFIX}${gameSlug}`);
      expect(productId).toMatch(/^[a-z0-9][a-z0-9_.]{0,39}$/);
    }
    expect(new Set(PREMIUM_PRODUCTS.map((p) => p.productId)).size).toBe(PREMIUM_PRODUCTS.length);
  });

  it("maps game ↔ product both ways", () => {
    expect(productIdForGame("hearts")).toBe("com.buffingchi.games.premium.hearts");
    expect(gameForProductId("com.buffingchi.games.premium.hearts")).toBe("hearts");
    expect(productIdForGame("yacht")).toBeUndefined();
    expect(gameForProductId("com.buffingchi.games.premium.yacht")).toBeUndefined();
  });
});
