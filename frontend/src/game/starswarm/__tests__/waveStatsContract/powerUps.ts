/**
 * Wave-stats contract rows: `powerUps`. Empty until #3246 adds the power-up lifecycle counters (spawned / collected / missed / leftover by type and source) — and replaces
 * `pending` with a row for every registry value and field it counts. See ./contract.ts.
 */
import type { SectionContract } from "./contract";

export const contract: SectionContract<"powerUps"> = {
  section: "powerUps",
  pending: { stories: ["#3246"], covers: "all" },
  rows: [],
};
