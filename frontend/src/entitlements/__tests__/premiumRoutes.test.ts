/**
 * premiumRoutes (#2390) — App.tsx registers premium routes and tabs from this
 * registry, so these assertions are the automated guard that a store build has
 * no route to a hidden game and no Star Swarm-only Ranks tab.
 */
import { PREMIUM_GAMES } from "../EntitlementContext";
import { __forceStoreBuildForTests } from "../gameVisibility";
import {
  PREMIUM_ROUTES,
  PREMIUM_TABS,
  visiblePremiumRoutes,
  visiblePremiumTabs,
} from "../premiumRoutes";

describe("premiumRoutes", () => {
  afterEach(() => {
    __forceStoreBuildForTests(false);
  });

  it("dev build registers every premium route and the Ranks tab", () => {
    expect(visiblePremiumRoutes().map((r) => r.route)).toEqual([
      "BlackjackBetting",
      "BlackjackTable",
      "BlackjackVictory",
      "BlackjackStats",
      "Cascade",
      "StarSwarm",
      "Hearts",
      "Sudoku",
      "Sort",
    ]);
    expect(visiblePremiumTabs().map((t) => t.tab)).toEqual(["Ranks"]);
  });

  it("store build registers no premium route and no Ranks tab", () => {
    __forceStoreBuildForTests(true);
    expect(visiblePremiumRoutes()).toEqual([]);
    expect(visiblePremiumTabs()).toEqual([]);
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

  it("every premium tab belongs to a premium game", () => {
    for (const { slug } of PREMIUM_TABS) expect(PREMIUM_GAMES.has(slug)).toBe(true);
  });
});
