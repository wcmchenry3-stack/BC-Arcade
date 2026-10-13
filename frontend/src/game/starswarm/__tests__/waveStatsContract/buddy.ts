/**
 * Wave-stats contract rows: `buddy`. Empty until #3248 adds the Buddy counters (launched, hits and losses by cause, shots drawn, kills by tier) — and replaces
 * `pending` with a row for every registry value and field it counts. See ./contract.ts.
 */
import type { SectionContract } from "./contract";

export const contract: SectionContract<"buddy"> = {
  section: "buddy",
  pending: { stories: ["#3248"], covers: "all" },
  rows: [],
};
