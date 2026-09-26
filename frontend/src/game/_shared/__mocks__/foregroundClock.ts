/**
 * Shared test mock for `foregroundClock` (#2710).
 *
 * `jest.setup.ts` pins it for every test file, so `useGameSync`'s active-play
 * window only moves when a test moves it: a screen test's exact completion
 * summary can't pick up real test time. The clock starts at 0 before each test
 * (`jest.setup-after-env.ts`). A test moves it with the helpers, reached
 * through `jest.requireMock` so they act on the instance the screen uses:
 *
 *   const clock = jest.requireMock<ForegroundClockMock>("../../game/_shared/foregroundClock");
 *   clock.advanceForegroundNow(45_000);
 *
 * Tests of the real clock (and of the hook against it) opt out with
 * `jest.unmock(".../foregroundClock")`.
 */

let now = 0;

/** The pinned foreground time, in milliseconds. */
export function foregroundNow(): number {
  return now;
}

/** Test-only: set the foreground time. */
export function setForegroundNow(ms: number): void {
  now = ms;
}

/** Test-only: move the foreground time forward by `ms`. */
export function advanceForegroundNow(ms: number): void {
  now += ms;
}

/** Test-only: back to 0 (the real module's reset has the same name). */
export function __resetForegroundClockForTests(): void {
  now = 0;
}

/** The mock's shape, for `jest.requireMock<ForegroundClockMock>(...)`. */
export interface ForegroundClockMock {
  foregroundNow: typeof foregroundNow;
  setForegroundNow: typeof setForegroundNow;
  advanceForegroundNow: typeof advanceForegroundNow;
  __resetForegroundClockForTests: typeof __resetForegroundClockForTests;
}
