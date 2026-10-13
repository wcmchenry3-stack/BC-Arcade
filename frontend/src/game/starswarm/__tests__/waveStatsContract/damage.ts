/**
 * Wave-stats contract rows: `damage`. Empty until #3248 adds the player-damage counters (hits by cause × result, death cause) — and replaces
 * `pending` with a row for every registry value and field it counts. See ./contract.ts.
 */
import type { SectionContract } from "./contract";

export const contract: SectionContract<"damage"> = {
  section: "damage",
  pending: { stories: ["#3248"], covers: "all" },
  rows: [],
};
