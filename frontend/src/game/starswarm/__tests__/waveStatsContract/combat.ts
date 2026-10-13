/**
 * Wave-stats contract rows: `combat`. Empty until #3248 adds the combat counters (spawned and kills by tier × method, shots fired / hit / on rocks) — and replaces
 * `pending` with a row for every registry value and field it counts. See ./contract.ts.
 */
import type { SectionContract } from "./contract";

export const contract: SectionContract<"combat"> = {
  section: "combat",
  pending: { stories: ["#3248"], covers: "all" },
  rows: [],
};
