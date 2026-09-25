/**
 * The navigation surface each premium game owns (#2390) — pure data, no React.
 *
 * `App.tsx` registers these routes/tabs from this table instead of listing them
 * by hand, so a game hidden by `gameVisibility.ts` cannot keep a reachable
 * route, and `premiumRoutes.test.ts` can assert that without rendering the app.
 */
import { isGameVisible } from "./gameVisibility";

export const PREMIUM_ROUTES = [
  // Blackjack moved to premium and Yacht to free on 2026-09-23 (owner): Blackjack
  // is simulated gambling, which would rate the whole app 13+/18+ (PEGI 18).
  { slug: "blackjack", route: "BlackjackBetting" },
  { slug: "blackjack", route: "BlackjackTable" },
  { slug: "blackjack", route: "BlackjackVictory" },
  { slug: "blackjack", route: "BlackjackStats" },
  { slug: "cascade", route: "Cascade" },
  { slug: "starswarm", route: "StarSwarm" },
  { slug: "hearts", route: "Hearts" },
  // Mahjong moved to premium and Sort to free on 2026-09-24 (owner).
  { slug: "mahjong", route: "Mahjong" },
  // Sudoku moved to free on 2026-09-25 (owner) — no compensating premium swap.
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
