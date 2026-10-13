/**
 * Wave-stats contract rows: `rocks`. Empty until #3247 adds the asteroid counters (spawned, broken by whom, enemies struck and destroyed by tier, hits on the player and Buddy) — and replaces
 * `pending` with a row for every registry value and field it counts. See ./contract.ts.
 */
import type { SectionContract } from "./contract";

export const contract: SectionContract<"rocks"> = {
  section: "rocks",
  pending: { stories: ["#3247"], covers: "all" },
  rows: [],
};
