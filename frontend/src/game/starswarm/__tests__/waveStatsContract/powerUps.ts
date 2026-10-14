/**
 * Wave-stats contract rows: `powerUps`. Empty until #3246 adds the
 * power-up lifecycle counters (spawned / collected / missed / leftover by type and source).
 *
 * `pending` lists today's registry values and fields one by one — never derived from the
 * registries — so a value added later is neither covered nor pending and the contract test fails.
 * #3246 replaces each pending entry with a row that proves it is counted. See ./contract.ts.
 */
import { field, key, type SectionContract } from "./contract";

export const contract: SectionContract<"powerUps"> = {
  section: "powerUps",
  pending: {
    stories: ["#3246"],
    covers: [
      key("POWERUP_TYPES", "lightning"),
      key("POWERUP_TYPES", "shield"),
      key("POWERUP_TYPES", "buddy"),
      key("POWERUP_TYPES", "bomb"),
      key("POWERUP_TYPES", "salvage"),
      key("POWERUP_TYPES", "hull"),
      key("POWERUP_SOURCES", "kill"),
      key("POWERUP_SOURCES", "rock"),
      key("POWERUP_SOURCES", "carrier"),
      key("POWERUP_SOURCES", "dev"),
      field("powerUps", "spawned"),
      field("powerUps", "collected"),
      field("powerUps", "missed"),
      field("powerUps", "leftover"),
      field("powerUps", "expired"),
      field("powerUps", "activeMs"),
      field("powerUps", "shieldAbsorbed"),
    ],
  },
  rows: [],
};
