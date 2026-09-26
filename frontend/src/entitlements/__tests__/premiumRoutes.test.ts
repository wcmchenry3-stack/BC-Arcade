/**
 * premiumRoutes (#2390) — App.tsx registers premium routes from this registry,
 * so these assertions are the automated guard that a store build has no route
 * to a hidden game. (Tabs are the same in every build: mainTabs.test.tsx.)
 */
import { PREMIUM_GAMES } from "../EntitlementContext";
import { __forceStoreBuildForTests } from "../gameVisibility";
import { PREMIUM_ROUTES, visiblePremiumRoutes } from "../premiumRoutes";

describe("premiumRoutes", () => {
  afterEach(() => {
    __forceStoreBuildForTests(false);
  });

  it("dev build registers every premium route", () => {
    expect(visiblePremiumRoutes().map((r) => r.route)).toEqual([
      "BlackjackBetting",
      "BlackjackTable",
      "BlackjackVictory",
      "BlackjackStats",
      "Cascade",
      "StarSwarm",
      "Hearts",
      "Mahjong",
    ]);
  });

  it("store build registers no premium route", () => {
    __forceStoreBuildForTests(true);
    expect(visiblePremiumRoutes()).toEqual([]);
  });

  it("every premium route belongs to a premium game, every premium game has at least one route, and route names are unique", () => {
    for (const { slug } of PREMIUM_ROUTES) {
      expect(PREMIUM_GAMES.has(slug)).toBe(true);
    }
    const routedGames = new Set<string>(PREMIUM_ROUTES.map((r) => r.slug));
    for (const slug of PREMIUM_GAMES) {
      expect(routedGames.has(slug)).toBe(true);
    }
    const routeNames = PREMIUM_ROUTES.map((r) => r.route);
    expect(new Set(routeNames).size).toBe(routeNames.length);
  });
});
