/**
 * Stand-in for a hidden premium game's screen in a store bundle (#2830).
 *
 * `metro/storeBundle.js` resolves those screens to this module when building a
 * store bundle so their code and assets are not packaged. No route reaches it
 * there — hidden games register no route — so it renders nothing.
 */
export default function StoreBuildExcludedScreen(): null {
  return null;
}
