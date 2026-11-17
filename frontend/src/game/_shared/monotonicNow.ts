/**
 * monotonicNow: the one time source for measuring durations (#3925).
 *
 * `performance.now()` (Hermes, React Native and web) is monotonic: setting the
 * device clock back or forward does not move it, so a player cannot shorten or
 * stretch a measured play time (Cascade's time bonus, #3700, makes that worth
 * points). `Date.now()` is the fallback only where `performance` is missing.
 *
 * Its values have an arbitrary origin that resets when the app restarts, so a
 * reading is only meaningful next to another from the same run: never persist
 * one, and never show one as a time of day. Persist banked milliseconds
 * (`playedMs`, `accumulatedMs`) instead, and use `Date.now()` where a real
 * timestamp is wanted (`savedAt`).
 *
 * Every clock function takes a `now` argument defaulting to this, so tests
 * drive a clock by passing a number, or by mocking `performance.now`.
 */
export function monotonicNow(): number {
  const perf = (globalThis as { performance?: { now?: () => number } }).performance;
  return typeof perf?.now === "function" ? perf.now() : Date.now();
}
