/**
 * Sentry init decisions, kept pure so every build flavour can be tested
 * (#851, #2429). `App.tsx` only wires these into `Sentry.init`.
 *
 * Until Sep 2026 `environment` defaulted to "production", so every TestFlight
 * build against the dev API, every simulator run and every CI smoke build
 * reported as production and launch-day crash-free numbers meant nothing.
 */

import { Platform } from "react-native";
import { areTestHooksEnabled, isPreLaunchApiBuild } from "../game/_shared/envFlags";

export type SentryEnvironment = "production" | "development";

/**
 * An explicit `EXPO_PUBLIC_SENTRY_ENVIRONMENT` wins. Otherwise the environment
 * follows the API URL — the same rule as game visibility (#2417) — so there is
 * no switch to remember: pointing a build at the production API flips
 * visibility, entitlements and the Sentry environment in one step. Debug
 * builds are always "development", whatever API they talk to.
 */
export function resolveSentryEnvironment(isDev: boolean = __DEV__): string {
  const explicit = process.env.EXPO_PUBLIC_SENTRY_ENVIRONMENT;
  if (explicit) return explicit;
  if (isDev || isPreLaunchApiBuild()) return "development";
  return "production";
}

/**
 * Test-hooks builds (CI smoke, Maestro) never report. `httpClient` gates its
 * `captureMessage` calls on the test build but not `captureException`, so the
 * only complete gate is not initialising at all.
 * Expo Web is an unmaintained secondary target; its Sentry noise is suppressed
 * by never initialising at all (#2716).
 */
export function shouldInitSentry(platformOS: string = Platform.OS): boolean {
  if (platformOS === "web") return false;
  return !areTestHooksEnabled();
}

/**
 * App Hang tracking is native and bypasses `beforeSend`, so it is switched off
 * at init for debug builds — simulator "hangs" are scheduler artefacts with no
 * first-party frames (BC_GAMES-4X / 4Z).
 */
export function shouldTrackAppHangs(isDev: boolean = __DEV__): boolean {
  return !isDev;
}

type EventWithDevice = { contexts?: { device?: { simulator?: unknown } } };

/**
 * `beforeSend` hook: a simulator or emulator must never add to the
 * `production` environment (a Release simulator build loads the tracked
 * `.env.production`). Other environments keep their simulator events — they
 * are useful when debugging the Sentry integration itself.
 */
export function makeDropSimulatorEvents<E extends EventWithDevice>(
  environment: string
): (event: E) => E | null {
  return (event) => {
    if (environment === "production" && event.contexts?.device?.simulator === true) return null;
    return event;
  };
}
