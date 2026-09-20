/**
 * The navigation surface each premium game owns (#2390) — pure data, no React.
 *
 * `App.tsx` registers these routes/tabs from this table instead of listing them
 * by hand, so a game hidden by `gameVisibility.ts` cannot keep a reachable
 * route, and `premiumRoutes.test.ts` can assert that without rendering the app.
 */
import { isGameVisible } from "./gameVisibility";

export const PREMIUM_ROUTES = [
  { slug: "yacht", route: "Game" },
  { slug: "cascade", route: "Cascade" },
  { slug: "starswarm", route: "StarSwarm" },
  { slug: "hearts", route: "Hearts" },
  { slug: "sudoku", route: "Sudoku" },
  { slug: "sort", route: "Sort" },
] as const;

/** Tabs that only make sense while their game exists (the leaderboard is Star Swarm-only). */
export const PREMIUM_TABS = [{ slug: "starswarm", tab: "Ranks" }] as const;

export type PremiumRoute = (typeof PREMIUM_ROUTES)[number];
export type PremiumRouteName = PremiumRoute["route"];
export type PremiumTab = (typeof PREMIUM_TABS)[number];
export type PremiumTabName = PremiumTab["tab"];

export function visiblePremiumRoutes(): PremiumRoute[] {
  return PREMIUM_ROUTES.filter(({ slug }) => isGameVisible(slug));
}

export function visiblePremiumTabs(): PremiumTab[] {
  return PREMIUM_TABS.filter(({ slug }) => isGameVisible(slug));
}
