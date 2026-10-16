/**
 * Store build vs internal build — the one build-flavour decision (#3150).
 *
 * Internal builds are dev builds, e2e test builds (`EXPO_PUBLIC_TEST_HOOKS=1`,
 * set by the Maestro/Playwright build jobs) and builds compiled against the
 * pre-launch API (internal TestFlight / Play test). Everything else is a store
 * build. See `entitlements/gameVisibility.ts` for why this is keyed off
 * build-time inputs rather than a new env var or a server flag.
 *
 * Features that hold content back from store users read this and keep their own
 * rule on top of it: hidden games (`SHOW_HIDDEN_GAMES`) and unlaunched locales
 * (`i18n/resolveLocale.ts`). Unhiding one never unhides the other.
 */
import { areTestHooksEnabled, isPreLaunchApiBuild } from "./envFlags";

export const IS_INTERNAL_BUILD: boolean = __DEV__ || areTestHooksEnabled() || isPreLaunchApiBuild();

let forcedStoreBuild = false;

/**
 * Test seam: makes every store-build gate answer as a store build would — hidden
 * games (`isGameVisible`) and unlaunched locales (`availableLocales`,
 * `resolveLocale`) — so suites can exercise the real predicates under Jest's
 * `__DEV__ === true`. Module-global: reset it in `afterEach`. Hide-only by
 * design — there is no way to force a store build *internal*, so this can never
 * weaken a store build.
 * @internal Exported for tests and offline tooling only; no production caller (knip --production, #3126).
 */
export function __forceStoreBuildForTests(on: boolean): void {
  forcedStoreBuild = on;
}

/** True while `__forceStoreBuildForTests(true)` is in effect. */
export function isStoreBuildForced(): boolean {
  return forcedStoreBuild;
}

/** True in a store build, or while a test forces one. */
export function isStoreBuild(): boolean {
  return forcedStoreBuild || !IS_INTERNAL_BUILD;
}
