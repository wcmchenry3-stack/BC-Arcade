/**
 * BlackjackBettingScreen — the `BlackjackBetting` route (#3580).
 *
 * Betting, play and the result now happen on one table screen
 * (BlackjackTableScreen), with no screen swap between hands. This route name is
 * kept, and renders that same screen, because it is the game's entry route: the
 * lobby's Play button, the paywall's return (`entryRouteForSlug`) and the
 * victory screen's Keep Playing / Next Table all open it. Rendering the table
 * here (rather than redirecting) means entering the game is one transition and
 * Back still returns to where it was opened from. Nothing navigates between
 * `BlackjackBetting` and `BlackjackTable` any more.
 */
export { default } from "./BlackjackTableScreen";
