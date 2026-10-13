/**
 * Wave-stats contract rows: `carrier`. Empty until #3249 adds the Carrier counters (grunts launched, armor deflects, beams, attack runs, stage times) — and replaces
 * `pending` with a row for every registry value and field it counts. See ./contract.ts.
 */
import type { SectionContract } from "./contract";

export const contract: SectionContract<"carrier"> = {
  section: "carrier",
  pending: { stories: ["#3249"], covers: "all" },
  rows: [],
};
