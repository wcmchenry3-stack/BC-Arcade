/**
 * One gate and one install/cleanup path for every E2E test hook (#2975).
 *
 * `registerTestHooks("starswarm", { endRun, getRunStats })` installs
 * `globalThis.__starswarm_endRun` and `globalThis.__starswarm_getRunStats` when
 * the build has `EXPO_PUBLIC_TEST_HOOKS=1`, and is a no-op otherwise. The
 * returned function removes exactly what this call installed, so it can be the
 * return value of a `useEffect`.
 *
 * Imports only the dependency-free `envFlags` leaf, so any screen or engine can
 * use it without pulling in the logstore (see `envFlags.ts`).
 */
import { areTestHooksEnabled } from "../envFlags";

export function registerTestHooks(
  namespace: string,
  hooks: Record<string, (...args: never[]) => unknown>
): () => void {
  if (!areTestHooksEnabled()) return () => {};
  const g = globalThis as unknown as Record<string, unknown>;
  const names = Object.keys(hooks).map((key) => `__${namespace}_${key}`);
  Object.entries(hooks).forEach(([key, fn]) => {
    g[`__${namespace}_${key}`] = fn;
  });
  return () => {
    for (const name of names) delete g[name];
  };
}
