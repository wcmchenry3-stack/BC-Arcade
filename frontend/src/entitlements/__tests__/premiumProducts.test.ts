/**
 * premiumProducts (#2785) — the store catalog must cover exactly the premium
 * games, with one store-valid product ID per game. The backend half of this
 * guard is backend/tests/test_premium_products.py (game_types.is_premium).
 */
import { PREMIUM_GAMES } from "../EntitlementContext";
import { DISABLED_GAMES, HIDDEN_GAMES } from "../gameVisibility";
import {
  PREMIUM_PRODUCTS,
  PRODUCT_ID_PREFIX,
  STORE_PRODUCTS,
  isPremiumGameSlug,
  type PremiumGameSlug,
} from "../premiumProducts";

const slugs = () => new Set(PREMIUM_PRODUCTS.map((p) => p.gameSlug));

describe("premiumProducts", () => {
  it("has one product for every premium game and nothing else", () => {
    expect(slugs()).toEqual(PREMIUM_GAMES);
    expect(PREMIUM_PRODUCTS).toHaveLength(PREMIUM_GAMES.size);
  });

  it("makes every game hidden in v1.0 store builds purchasable", () => {
    // Subset, not equality: a game may be hidden for non-premium reasons, but a
    // hidden premium game must still have a product so it can be unlocked.
    const purchasable = slugs();
    for (const slug of HIDDEN_GAMES) {
      expect(purchasable.has(slug as PremiumGameSlug)).toBe(true);
    }
  });

  it("narrows slugs with isPremiumGameSlug", () => {
    const expected: PremiumGameSlug[] = ["blackjack", "cascade", "hearts", "mahjong", "starswarm"];
    for (const slug of expected) expect(isPremiumGameSlug(slug)).toBe(true);
    expect([...slugs()].sort()).toEqual(expected);
    for (const slug of ["yacht", "sudoku", "", "Hearts", "com.buffingchi.games.premium.hearts"]) {
      expect(isPremiumGameSlug(slug)).toBe(false);
    }
  });

  it("uses the shared product-ID convention, valid on both stores", () => {
    for (const { gameSlug, productId } of PREMIUM_PRODUCTS) {
      expect(productId).toBe(`${PRODUCT_ID_PREFIX}${gameSlug}`);
      expect(productId).toMatch(/^[a-z0-9][a-z0-9_.]{0,39}$/);
    }
    expect(new Set(PREMIUM_PRODUCTS.map((p) => p.productId)).size).toBe(PREMIUM_PRODUCTS.length);
  });

  describe("store products (#3001)", () => {
    const storeSlugs = () => STORE_PRODUCTS.map((p) => p.gameSlug).sort();

    it("leaves Cascade out of the store list while keeping its catalog entry", () => {
      expect(storeSlugs()).toEqual(["blackjack", "hearts", "mahjong", "starswarm"]);
      expect(PREMIUM_PRODUCTS.find((p) => p.gameSlug === "cascade")?.enabled).toBe(false);
    });

    it("sells every premium game except the disabled ones", () => {
      const expected = [...PREMIUM_GAMES].filter((s) => !DISABLED_GAMES.has(s)).sort();
      expect(storeSlugs()).toEqual(expected);
    });

    it("only a disabled game may hold its product back", () => {
      const heldBack = PREMIUM_PRODUCTS.filter((p) => p.enabled === false).map((p) => p.gameSlug);
      expect(heldBack.sort()).toEqual([...DISABLED_GAMES].sort());
      // An explicit `enabled: true` is allowed; it means the same as leaving it out.
      for (const p of PREMIUM_PRODUCTS) expect([undefined, true, false]).toContain(p.enabled);
    });
  });
});
