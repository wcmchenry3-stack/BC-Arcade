/**
 * The react-native-gesture-handler version this build ships, for the `starswarm.shipStuck`
 * event (#4079): the prime suspect for the stuck ship is the 3.4.0 → 3.5.0 bump (#3854), so
 * every report says which one it ran on.
 *
 * A constant, not `require("react-native-gesture-handler/package.json").version`: that would
 * put the whole package.json in the bundle for one string. `__tests__/rnghVersion.test.ts`
 * fails when package.json's pinned version and this constant drift apart, so a bump of the
 * dependency has to update it.
 */
export const RNGH_VERSION = "3.5.0";
