/**
 * Star Swarm engine — public surface (#2988).
 *
 * A pure re-export barrel over `engine/`: every importer (`GameCanvas`, `Controls`,
 * `StarSwarmScreen`, the renderers, `pauseStore`, the balance simulator and the tests) keeps
 * importing from `game/starswarm/engine`. The modules, in dependency order:
 *
 *   tuning      every tunable, the difficulty tiers and the injectable `Tuning` object
 *   rng         the seeded LCG and the id counters (the run's replay counters)
 *   geometry    Béziers, overlap tests, the formation layout, path factories, aim, `hashFrac`
 *   roster      roster reads (leader tiers, the Carrier's armor and stage), `TickCtx`, `mapKeep`
 *   stats       per-tier and run-wide counters
 *   entities    pickups, explosions, the power-up type roll
 *   extraction  the `weaponsFree` / `hazardsLive` gates, live hazards, the autopilot, the reset
 *   asteroids   rocks, their threat contract, and the enemies' response to them
 *   buddy       Buddy: station, attack runs, evasion, the fire it draws, the hits it takes
 *   carrier     the Carrier's cadences, volley seam, beam, attack run and event selectors
 *   enemyPhases the per-ship phase machine (SwoopIn → Formation → Wiggling → Diving → …)
 *   enemies     `tickEnemies`: the fleet-wide tick (dives, sway, the Carrier context, reinforcements)
 *   collisions  bullets in flight and the single damage-resolution pass
 *   powerups    the player's volley, upgrade ladders, pickups and `applyPowerUp`
 *   wave        `initStarSwarm`, `buildWaveState`, `tick`, the phase machine (module header there)
 *
 * See docs/ARCHITECTURE.md §3 and docs/games/starswarm.md.
 */
export * from "./engine/tuning";
export * from "./engine/rng";
export * from "./engine/geometry";
export * from "./engine/roster";
export * from "./engine/stats";
export * from "./engine/entities";
export * from "./engine/extraction";
export * from "./engine/asteroids";
export * from "./engine/buddy";
export * from "./engine/carrier";
export * from "./engine/enemyPhases";
export * from "./engine/enemies";
export * from "./engine/collisions";
export * from "./engine/powerups";
export * from "./engine/wave";
