/**
 * Wave-stats contract rows: `rout`. Empty until #3249 adds the rout counters (triggered, when, grunts, caught, escaped) — and replaces
 * `pending` with a row for every registry value and field it counts. See ./contract.ts.
 */
import type { SectionContract } from "./contract";

export const contract: SectionContract<"rout"> = {
  section: "rout",
  pending: { stories: ["#3249"], covers: "all" },
  rows: [],
};
