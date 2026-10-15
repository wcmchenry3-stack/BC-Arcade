/**
 * Every AsyncStorage read method the event queue can use (#3333 review S1):
 * `getItem` (the meta row, #2959 tier keys), `getMany` (chunk keys) and
 * `getAllKeys` (the load's key scan). A "reads nothing" assertion that
 * watches only `getItem` would pass even when the whole queue is reloaded.
 */

import AsyncStorage from "@react-native-async-storage/async-storage";

const READS = ["getItem", "getMany", "getAllKeys"] as const;

function mocks(): jest.Mock[] {
  const storage = AsyncStorage as unknown as Record<(typeof READS)[number], jest.Mock>;
  return READS.map((name) => storage[name]);
}

/** Calls to any AsyncStorage read method since the last `clearStorageReads()`. */
export function storageReads(): number {
  return mocks().reduce((n, mock) => n + mock.mock.calls.length, 0);
}

/** Reset the call counts of every AsyncStorage read method. */
export function clearStorageReads(): void {
  for (const mock of mocks()) mock.mockClear();
}
