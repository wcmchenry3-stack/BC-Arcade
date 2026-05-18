import type { Layout, Slot } from "../types";

/**
 * Parse a raw JSON array into a validated Layout.
 *
 * Throws if the entry count doesn't match `expectedCount` (default 144) or if
 * any two entries share the same (col, row, layer) coordinate triple.
 */
export function parseLayout(
  json: readonly { col: number; row: number; layer: number }[],
  expectedCount = 144
): Layout {
  if (json.length !== expectedCount) {
    throw new Error(`parseLayout: expected ${expectedCount} slots, got ${json.length}`);
  }
  const seen = new Set<string>();
  for (const s of json) {
    const key = `${s.col},${s.row},${s.layer}`;
    if (seen.has(key)) {
      throw new Error(`parseLayout: duplicate coordinate ${key}`);
    }
    seen.add(key);
  }
  return json as readonly Slot[];
}
