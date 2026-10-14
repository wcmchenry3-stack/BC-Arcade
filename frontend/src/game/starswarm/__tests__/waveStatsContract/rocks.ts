/**
 * Wave-stats contract rows: `rocks`. Empty until #3247 adds the
 * asteroid counters (spawned, broken by whom, enemies struck and destroyed by tier, hits on the player and Buddy).
 *
 * `pending` lists today's registry values and fields one by one — never derived from the
 * registries — so a value added later is neither covered nor pending and the contract test fails.
 * #3247 replaces each pending entry with a row that proves it is counted. See ./contract.ts.
 */
import { field, key, type SectionContract } from "./contract";

export const contract: SectionContract<"rocks"> = {
  section: "rocks",
  pending: {
    stories: ["#3247"],
    covers: [
      key("ASTEROID_KINDS", "large"),
      key("ASTEROID_KINDS", "small"),
      key("ROCK_BREAKERS", "player"),
      key("ROCK_BREAKERS", "enemy"),
      key("ROCK_BREAKERS", "bomb"),
      key("ROCK_BREAKERS", "contact"),
      key("ENEMY_TIERS", "Grunt"),
      key("ENEMY_TIERS", "Elite"),
      key("ENEMY_TIERS", "Guardian"),
      key("ENEMY_TIERS", "Carrier"),
      key("HIT_RESULTS", "life"),
      key("HIT_RESULTS", "plating"),
      key("HIT_RESULTS", "shield"),
      field("rocks", "spawned"),
      field("rocks", "devSpawned"),
      field("rocks", "broken"),
      field("rocks", "enemiesStruck"),
      field("rocks", "enemiesDestroyed"),
      field("rocks", "playerHits"),
      field("rocks", "buddyHits"),
      field("rocks", "buddyDestroyed"),
      field("rocks", "dodge"),
    ],
  },
  rows: [],
};
