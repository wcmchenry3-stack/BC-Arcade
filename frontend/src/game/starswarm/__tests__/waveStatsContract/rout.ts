/**
 * Wave-stats contract rows: `rout`. Empty until #3249 adds the
 * rout counters (triggered, when, grunts, caught, escaped).
 *
 * `pending` lists today's registry values and fields one by one — never derived from the
 * registries — so a value added later is neither covered nor pending and the contract test fails.
 * #3249 replaces each pending entry with a row that proves it is counted. See ./contract.ts.
 */
import { field, type SectionContract } from "./contract";

export const contract: SectionContract<"rout"> = {
  section: "rout",
  pending: {
    stories: ["#3249"],
    covers: [
      field("rout", "triggered"),
      field("rout", "atMs"),
      field("rout", "grunts"),
      field("rout", "caught"),
      field("rout", "escaped"),
    ],
  },
  rows: [],
};
