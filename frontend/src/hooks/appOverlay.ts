import { useEffect, useSyncExternalStore } from "react";

/**
 * The "app overlay" signal (#2944): true while app chrome covers the game
 * screen with a native `Modal` of its own — the header's ⋯ menu, the feedback
 * sheet it opens (or the "?" button's), or the New Game confirmation.
 *
 * It's a module-level store, not a context: the screens that act on it call
 * their pause hooks (`usePauseWhileAway`, `usePausableClock`) above the
 * `GameShell` that renders the header, where a context it provided couldn't
 * reach them. Only the focused screen's header can be tapped, so one app-wide
 * flag is enough: a screen under another one is already away (blurred).
 *
 * Each reporter (`useReportAppOverlay`) holds its own token, so two headers
 * mounted at once (a stack mid-transition) never clear each other's state.
 */

type Listener = () => void;

const openTokens = new Set<symbol>();
const listeners = new Set<Listener>();

function emit() {
  for (const listener of [...listeners]) listener();
}

/** Whether an app overlay is open right now. */
export function isAppOverlayOpen(): boolean {
  return openTokens.size > 0;
}

/** Subscribes to changes of `isAppOverlayOpen()`; returns the unsubscribe. */
export function subscribeAppOverlay(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function setTokenOpen(token: symbol, open: boolean) {
  const was = isAppOverlayOpen();
  if (open) openTokens.add(token);
  else openTokens.delete(token);
  if (isAppOverlayOpen() !== was) emit();
}

/** Whether an app overlay is open, re-rendering when that changes. */
export function useAppOverlayOpen(): boolean {
  return useSyncExternalStore(subscribeAppOverlay, isAppOverlayOpen, isAppOverlayOpen);
}

/**
 * Tests only: forgets every open overlay, without notifying anyone. A test
 * that leaves a header mounted with its menu open (react-test-renderer has
 * no auto-cleanup) must not start the next test's screen paused.
 * `jest.setup-after-env.ts` calls it before each test.
 * @public Reached only through `jest.requireActual`, which knip cannot follow.
 */
export function __resetAppOverlayForTests(): void {
  openTokens.clear();
}

/**
 * Reports this component's overlay as open while `open` is true, and closed
 * on unmount. `AppHeader` calls it for its menu and sheets.
 */
export function useReportAppOverlay(open: boolean): void {
  useEffect(() => {
    if (!open) return;
    const token = Symbol("appOverlay");
    setTokenOpen(token, true);
    return () => setTokenOpen(token, false);
  }, [open]);
}
