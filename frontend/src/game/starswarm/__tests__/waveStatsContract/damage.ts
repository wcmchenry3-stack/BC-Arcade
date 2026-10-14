/**
 * Wave-stats contract rows: `damage`. Empty until #3248 adds the
 * player-damage counters (hits by cause × result, death cause).
 *
 * `pending` lists today's registry values and fields one by one — never derived from the
 * registries — so a value added later is neither covered nor pending and the contract test fails.
 * #3248 replaces each pending entry with a row that proves it is counted. See ./contract.ts.
 */
import { field, key, type SectionContract } from "./contract";

export const contract: SectionContract<"damage"> = {
  section: "damage",
  pending: {
    stories: ["#3248"],
    covers: [
      key("HIT_CAUSES", "bullet"),
      key("HIT_CAUSES", "rock"),
      key("HIT_CAUSES", "beam"),
      key("HIT_CAUSES", "ram"),
      key("HIT_RESULTS", "life"),
      key("HIT_RESULTS", "plating"),
      key("HIT_RESULTS", "shield"),
      field("damage", "hits"),
      field("damage", "deathCause"),
    ],
  },
  rows: [],
};
