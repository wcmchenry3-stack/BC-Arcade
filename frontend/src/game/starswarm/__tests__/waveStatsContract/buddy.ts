/**
 * Wave-stats contract rows: `buddy`. Empty until #3248 adds the
 * Buddy counters (launched, hits and losses by cause, shots drawn, kills by tier).
 *
 * `pending` lists today's registry values and fields one by one — never derived from the
 * registries — so a value added later is neither covered nor pending and the contract test fails.
 * #3248 replaces each pending entry with a row that proves it is counted. See ./contract.ts.
 */
import { field, key, type SectionContract } from "./contract";

export const contract: SectionContract<"buddy"> = {
  section: "buddy",
  pending: {
    stories: ["#3248"],
    covers: [
      key("BUDDY_HIT_CAUSES", "bullet"),
      key("BUDDY_HIT_CAUSES", "beam"),
      key("BUDDY_HIT_CAUSES", "rock"),
      key("ENEMY_TIERS", "Grunt"),
      key("ENEMY_TIERS", "Elite"),
      key("ENEMY_TIERS", "Guardian"),
      key("ENEMY_TIERS", "Carrier"),
      field("buddy", "launched"),
      field("buddy", "hits"),
      field("buddy", "destroyed"),
      field("buddy", "shotsDrawn"),
      field("buddy", "kills"),
    ],
  },
  rows: [],
};
