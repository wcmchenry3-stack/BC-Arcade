/**
 * The one reading of `AppState` the sync pipeline shares (#2959): the app is
 * interrupted in `background` and `inactive` (an incoming call, the app
 * switcher), and in front of the player in every other state — `active`,
 * `unknown`, `extension`, and no state at all (jest, isolation). SyncWorker
 * pauses its interval, the capacity-warning toast its poll, NetworkContext's
 * breadcrumbs and the foreground clock all decide the same way.
 */
export function isAppInterrupted(state: unknown): boolean {
  return state === "background" || state === "inactive";
}
