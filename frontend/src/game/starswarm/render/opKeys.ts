/**
 * #2963: display-list op `key`s are for tests and debugging only.
 *
 * Building a template-literal key for every op every frame was pure per-frame garbage in the app
 * — nothing at runtime reads them — so `buildFrame` and its helpers attach keys only while this
 * flag is on. Tests that look ops up by key turn it on (`setDebugOpKeys(true)` in a `beforeAll`).
 */
let enabled = false;

export function setDebugOpKeys(on: boolean): void {
  enabled = on;
}

export function debugOpKeys(): boolean {
  return enabled;
}
