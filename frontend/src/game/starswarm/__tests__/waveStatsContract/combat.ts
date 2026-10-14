/**
 * Wave-stats contract rows: `combat`. Empty until #3248 adds the
 * combat counters (spawned and kills by tier × method, shots fired / hit / on rocks).
 *
 * `pending` lists today's registry values and fields one by one — never derived from the
 * registries — so a value added later is neither covered nor pending and the contract test fails.
 * #3248 replaces each pending entry with a row that proves it is counted. See ./contract.ts.
 */
import { field, key, type SectionContract } from "./contract";

export const contract: SectionContract<"combat"> = {
  section: "combat",
  pending: {
    stories: ["#3248"],
    covers: [
      key("ENEMY_TIERS", "Grunt"),
      key("ENEMY_TIERS", "Elite"),
      key("ENEMY_TIERS", "Guardian"),
      key("ENEMY_TIERS", "Carrier"),
      key("KILL_METHODS", "shot"),
      key("KILL_METHODS", "dive"),
      key("KILL_METHODS", "rout"),
      key("KILL_METHODS", "bomb"),
      key("KILL_METHODS", "ram"),
      key("KILL_METHODS", "rock"),
      key("KILL_METHODS", "buddy"),
      field("combat", "spawned"),
      field("combat", "kills"),
      field("combat", "shotsFired"),
      field("combat", "shotsHit"),
      field("combat", "shotsOnRocks"),
    ],
  },
  rows: [],
};
