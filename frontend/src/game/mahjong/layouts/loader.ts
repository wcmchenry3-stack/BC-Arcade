import type { Layout, Slot } from "../types";

/**
 * Validate a layout's slot list (from `layouts/<id>.ts`) and return it as a
 * Layout. The registry runs this for every layout at module init.
 *
 * Throws if the entry count doesn't match `expectedCount` (default 144) or if
 * any two entries share the same (col, row, layer) coordinate triple.
 */
export function parseLayout(slots: readonly Slot[], expectedCount = 144): Layout {
  if (slots.length !== expectedCount) {
    throw new Error(`parseLayout: expected ${expectedCount} slots, got ${slots.length}`);
  }
  const seen = new Set<string>();
  for (const s of slots) {
    const key = `${s.col},${s.row},${s.layer}`;
    if (seen.has(key)) {
      throw new Error(`parseLayout: duplicate coordinate ${key}`);
    }
    seen.add(key);
  }
  return slots;
}
