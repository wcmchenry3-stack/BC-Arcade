/**
 * Wave-stats contract rows: `carrier`. Empty until #3249 adds the
 * Carrier counters (grunts launched, armor deflects, beams, attack runs, stage times).
 *
 * `pending` lists today's registry values and fields one by one — never derived from the
 * registries — so a value added later is neither covered nor pending and the contract test fails.
 * #3249 replaces each pending entry with a row that proves it is counted. See ./contract.ts.
 */
import { field, key, type SectionContract } from "./contract";

export const contract: SectionContract<"carrier"> = {
  section: "carrier",
  pending: {
    stories: ["#3249"],
    covers: [
      key("CARRIER_STAGES", "protected"),
      key("CARRIER_STAGES", "exposed"),
      key("CARRIER_STAGES", "finalStand"),
      field("carrier", "gruntsLaunched"),
      field("carrier", "armorDeflects"),
      field("carrier", "beamsFired"),
      field("carrier", "beamHits"),
      field("carrier", "attackRuns"),
      field("carrier", "stageReachedMs"),
    ],
  },
  rows: [],
};
