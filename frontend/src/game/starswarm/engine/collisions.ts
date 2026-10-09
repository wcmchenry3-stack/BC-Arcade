/**
 * Star Swarm engine — bullets and collisions (#2988).
 *
 * `tickBullets` moves every projectile; `tickCollisions` is the one place damage resolves,
 * in a fixed order: player shots vs ships (`resolvePlayerShots`), rocks absorbing shots and
 * ramming ships (`resolveRockContacts`), the power-up drop and collection
 * (`resolvePickupCollection`, whose bomb is `applyBombBlast`, shared with `applyPowerUp`),
 * enemy shots vs rocks and Buddy, and finally hostiles vs the player (`resolvePlayerHit`:
 * shield → hull plating → a life). The sub-steps share one mutable `CollisionWork` scratch
 * (never the input state), and `assembleCollisionState` builds the single result.
 */
import type {
  Asteroid,
  BuddyShip,
  Bullet,
  CarrierBeam,
  Enemy,
  EnemyTier,
  Explosion,
  GunsLevel,
  HullLevel,
  Player,
  PowerUp,
  RunStats,
  StarSwarmState,
  TierStats,
} from "../types";
import { award, scoreSource, type ScorePoints } from "../scoreLedger";
import { absorbBulletsIntoRocks, rocksStrikeEnemies, settleRocks } from "./asteroids";
import { makeBuddy, resolveBuddyHits } from "./buddy";
import { makePickup, pickPowerUpType, powerUpDespawnMs, spawnExplosion } from "./entities";
import { arrivalsAllowed } from "./extraction";
import { aabb, circleCircle, collideCircleAABB } from "./geometry";
import { nextId, rng } from "./rng";
import { carrierArmoredIn, mapFilterKeep } from "./roster";
import { bumpRun, bumpStat } from "./stats";
import {
  BOMB_FLASH_DURATION,
  DEFAULT_TUNING,
  DIVE_SCORE_MULT,
  GUNS_MAX,
  HIT_FLASH_DURATION,
  HULL_INVINCIBLE_MS,
  HULL_MAX,
  PLAYER_HURT_RADIUS,
  PLAYER_INVINCIBLE_MS,
  POWERUP_DURATION,
  POWERUP_H,
  POWERUP_VY,
  POWERUP_W,
  TIER_SCORE,
  difficultyMultiplier,
  triggerKills,
  type Tuning,
} from "./tuning";

// ---------------------------------------------------------------------------
// Bullets
// ---------------------------------------------------------------------------

export function tickBullets(state: StarSwarmState, dtMs: number): StarSwarmState {
  const { canvasW, canvasH } = state;

  const move = (b: Bullet): Bullet => ({ ...b, x: b.x + b.vx * dtMs, y: b.y + b.vy * dtMs });
  const playerBullets = mapFilterKeep(
    state.playerBullets,
    move,
    (b) => b.y + b.height / 2 > 0 && b.x > -10 && b.x < canvasW + 10
  );

  const enemyBullets = mapFilterKeep(
    state.enemyBullets,
    move,
    (b) =>
      b.y - b.height / 2 < canvasH &&
      b.y + b.height / 2 > -20 && // #2487: flak fired upward at a rock leaves off the top
      b.x > -10 &&
      b.x < canvasW + 10
  );

  // #2843: released Carrier beams fly on whatever became of the Carrier; gone once the whole
  // bolt is below the screen
  const carrierBeams = mapFilterKeep(
    state.carrierBeams,
    (b) => ({ ...b, y: b.y + b.vy * dtMs }),
    (b) => b.y - b.length < canvasH
  );

  if (
    playerBullets === state.playerBullets &&
    enemyBullets === state.enemyBullets &&
    carrierBeams === state.carrierBeams
  ) {
    return state; // #2963: nothing in flight
  }
  return { ...state, playerBullets, enemyBullets, carrierBeams };
}

/** #2843: does this released beam touch the player's hurt circle? */
function beamHitsPlayer(b: CarrierBeam, p: Player): boolean {
  return collideCircleAABB(
    p.x,
    p.y,
    PLAYER_HURT_RADIUS,
    b.x,
    b.y - b.length / 2,
    b.halfWidth * 2,
    b.length
  );
}

// ---------------------------------------------------------------------------
// Collisions
// ---------------------------------------------------------------------------

/**
 * The one mutable scratch a collision pass works on. Opened from the input state (every list
 * copied, the input never touched), threaded through the `resolve*` steps in order, and turned
 * into the result by `assembleCollisionState`. Everything a step may change lives here, so the
 * steps compose without each returning a partial state.
 */
export interface CollisionWork {
  score: number;
  enemies: readonly Enemy[];
  playerBullets: readonly Bullet[];
  enemyBullets: readonly Bullet[];
  carrierBeams: readonly CarrierBeam[];
  /** The tick's rocks; `settleRocks` runs over them once, at assembly. */
  rocks: Asteroid[];
  explosions: Explosion[];
  powerUps: PowerUp[];
  /** Pickups spawned this tick (salvage from rocks, plating from the Carrier) — appended at assembly. */
  newDrops: PowerUp[];
  buddyShips: readonly BuddyShip[];
  tierStats: Record<EnemyTier, TierStats>;
  runStats: RunStats;
  killsSinceLastDrop: number;
  dropJitterTarget: number;
  activePowerUp: StarSwarmState["activePowerUp"];
  bombFlashTimer: number;
  /** A bomb was collected this tick: every enemy projectile in flight is cleared. */
  bombActivated: boolean;
  // #2488: in-run upgrade ladders — pickups raise them, a lost life lowers the guns, plating
  // absorbs a hit
  guns: GunsLevel;
  hull: HullLevel;
  hullFlashTimer: number;
}

function openCollisionWork(state: StarSwarmState): CollisionWork {
  const { player } = state;
  return {
    score: state.score,
    enemies: state.enemies,
    playerBullets: state.playerBullets,
    enemyBullets: state.enemyBullets,
    carrierBeams: state.carrierBeams,
    rocks: [...state.asteroids], // #2486
    explosions: [...state.explosions],
    powerUps: [...state.powerUps],
    newDrops: [],
    buddyShips: [...state.buddyShips],
    tierStats: { ...state.tierStats }, // #2487
    runStats: state.runStats, // #2491
    killsSinceLastDrop: state.killsSinceLastDrop,
    dropJitterTarget: state.dropJitterTarget,
    activePowerUp: state.activePowerUp,
    bombFlashTimer: state.bombFlashTimer,
    bombActivated: false,
    guns: player.guns,
    hull: player.hull,
    hullFlashTimer: player.hullFlashTimer,
  };
}

/** What `resolvePlayerHit` decided — nothing landed, plating took it, a life went, or the last one did. */
export type PlayerHit =
  | { readonly kind: "none" }
  | { readonly kind: "hull" }
  | { readonly kind: "life"; readonly lives: number }
  | { readonly kind: "dead" };

/**
 * The result of a collision pass: `state` with the scratch written over it, rocks settled
 * (broken ones pop, split and may drop salvage), this tick's drops appended, and the player
 * patched — the ladders always, plus whatever `patch` adds (lives, grace, a phase).
 */
export function assembleCollisionState(
  state: StarSwarmState,
  w: CollisionWork,
  patch: { readonly player?: Partial<Player>; readonly phase?: StarSwarmState["phase"] } = {}
): StarSwarmState {
  const settledRocks = settleRocks(w.rocks, w.explosions, w.newDrops, state.canvasH);
  const next: StarSwarmState = {
    ...state,
    enemies: w.enemies,
    asteroids: settledRocks, // #2486
    tierStats: w.tierStats,
    runStats: w.runStats,
    playerBullets: w.playerBullets,
    enemyBullets: w.enemyBullets,
    carrierBeams: w.carrierBeams,
    explosions: w.explosions,
    score: w.score,
    powerUps: [...w.powerUps, ...w.newDrops],
    buddyShips: w.buddyShips,
    killsSinceLastDrop: w.killsSinceLastDrop,
    dropJitterTarget: w.dropJitterTarget,
    activePowerUp: w.activePowerUp,
    bombFlashTimer: w.bombFlashTimer,
    player: {
      ...state.player,
      guns: w.guns,
      hull: w.hull,
      hullFlashTimer: w.hullFlashTimer,
      ...patch.player,
    }, // #2488
  };
  return patch.phase ? { ...next, phase: patch.phase } : next;
}

/**
 * Player bullets ↔ enemies. A non-piercing shot is spent on its first hit; a piercing one keeps
 * going but never damages the same enemy twice across its whole flight (`hitEnemyIds`), and a
 * capped one (Buddy's, `pierceLeft`) is spent on its last allowed hit. An escorted Carrier
 * shrugs off everything that isn't armor-piercing (#2484/#2845). Kills score here (#2837).
 */
export function resolvePlayerShots(
  state: StarSwarmState,
  w: CollisionWork,
  awards: ScorePoints,
  carrierArmored: boolean
): void {
  const scoreMult = difficultyMultiplier(state.difficulty);
  let armorDeflects = 0;
  let routCaught = 0; // #2489
  const hitBulletIds = new Set<number>(); // non-piercing bullets consumed this tick
  // Piercing bullets aren't consumed on hit, so a slow bullet can keep overlapping a big
  // hitbox across several ticks. New hits are staged here and merged into each bullet's
  // persistent `hitEnemyIds` after the pass, so a bullet can never damage the same enemy twice
  // across its whole flight — not just within this one tick.
  const newPiercingHits = new Map<number, number[]>(); // bulletId -> enemy ids newly hit this tick
  w.enemies = state.enemies.map((enemy) => {
    if (!enemy.isAlive) return enemy;

    for (const b of state.playerBullets) {
      if (hitBulletIds.has(b.id)) continue; // spent (a non-piercing hit, or a field deflection)
      if (b.piercing) {
        const alreadyHit = b.hitEnemyIds?.includes(enemy.id);
        const hitThisTick = newPiercingHits.get(b.id)?.includes(enemy.id);
        if (alreadyHit || hitThisTick) continue;
      }
      if (!aabb(b.x, b.y, b.width, b.height, enemy.x, enemy.y, enemy.width, enemy.height)) continue;

      if (b.piercing) {
        const hits = newPiercingHits.get(b.id);
        if (hits) hits.push(enemy.id);
        else newPiercingHits.set(b.id, [enemy.id]);
        // #2880: a capped shot (Buddy's) is spent on its last allowed hit — the hit still lands.
        // Lightning and the player's own piercing carry no counter and are never capped.
        if (
          b.pierceLeft !== undefined &&
          b.pierceLeft - (newPiercingHits.get(b.id)?.length ?? 0) <= 0
        )
          hitBulletIds.add(b.id);
      } else {
        hitBulletIds.add(b.id);
      }

      // #2484/#2845: an escorted Carrier shrugs off every shot that isn't armor-piercing — the
      // bullet is spent on the field (a piercing Buddy shot included: multi-hit through ordinary
      // hulls is not armor bypass), the ring plays, no damage. Lightning is the explicit exception.
      if (enemy.tier === "Carrier" && carrierArmored && !b.armorPiercing) {
        hitBulletIds.add(b.id);
        armorDeflects++;
        return { ...enemy, hitFlashTimer: HIT_FLASH_DURATION };
      }

      const newHp = enemy.hp - b.damage;

      if (newHp <= 0) {
        w.explosions.push(spawnExplosion(enemy.x, enemy.y));
        // #2488: the Carrier always drops hull plating
        if (enemy.tier === "Carrier")
          w.newDrops.push(makePickup("hull", enemy.x, enemy.y, state.canvasH));
        const base = TIER_SCORE[enemy.tier];
        // #2489: a fleeing grunt pays the dive multiplier — it was getting away
        const onTheMove =
          enemy.phase === "Diving" || enemy.phase === "Circling" || enemy.phase === "Fleeing";
        const mult = onTheMove ? DIVE_SCORE_MULT : 1;
        if (enemy.phase === "Fleeing") routCaught++;
        const mod = enemy.phase === "Fleeing" ? "rout" : onTheMove ? "dive" : undefined; // #2837
        w.score += award(awards, scoreSource(enemy.tier, mod), Math.round(base * mult * scoreMult));
        if (state.phase === "Playing") w.killsSinceLastDrop++;
        return { ...enemy, hp: 0, isAlive: false, hitFlashTimer: 0 };
      }

      // Non-lethal hit — shield ring burst (#1310); killing blow skips flash (explosion takes over)
      return { ...enemy, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
    }
    return enemy;
  });

  if (armorDeflects > 0) w.runStats = bumpRun(w.runStats, { armorDeflects });
  if (routCaught > 0) w.runStats = bumpRun(w.runStats, { routCaught });

  // Piercing bullets are removed by the off-screen filter in tickBullets, not here
  w.playerBullets = state.playerBullets
    .filter((b) => !hitBulletIds.has(b.id))
    .map((b) => {
      const hits = newPiercingHits.get(b.id);
      if (!hits) return b;
      return {
        ...b,
        hitEnemyIds: [...(b.hitEnemyIds ?? []), ...hits],
        ...(b.pierceLeft !== undefined ? { pierceLeft: b.pierceLeft - hits.length } : {}),
      };
    });
}

/**
 * #2486: rocks are cover — any player shot that reaches one is spent on it (piercing shots
 * included), then rocks ram whatever they fly into. Nobody scores for any of it. The armored
 * Carrier's field shatters a rock (#2844, judged on the tick's starting roster).
 */
export function resolveRockContacts(
  state: StarSwarmState,
  w: CollisionWork,
  carrierArmored: boolean
): void {
  const absorbed = absorbBulletsIntoRocks(w.playerBullets, w.rocks);
  w.playerBullets = absorbed.bullets;
  if (absorbed.broken > 0)
    w.runStats = bumpRun(w.runStats, { rocksBrokenByPlayer: absorbed.broken }); // #2491
  const struckTiers: EnemyTier[] = [];
  const struck = rocksStrikeEnemies(
    absorbed.rocks,
    w.enemies,
    w.explosions,
    struckTiers,
    carrierArmored, // #2844: the field is judged on the tick's starting roster
    w.newDrops,
    state.canvasH
  );
  w.rocks = struck.rocks;
  w.enemies = struck.enemies;
  if (struck.deflects > 0) w.runStats = bumpRun(w.runStats, { armorDeflects: struck.deflects });
  if (struckTiers.length > 0) {
    const next = { ...w.tierStats };
    for (const tier of struckTiers) bumpStat(next, tier, { struck: 1 });
    w.tierStats = next;
  }
}

/**
 * #1034 the Smart Bomb's blast, shared by collection and `applyPowerUp`: every rock shatters, and
 * every alive enemy takes 1 damage — except an escorted Carrier, whose field rings (#2484). Bomb
 * kills score at 1× (no dive multiplier) under the "bomb" source (#2837); a fleeing grunt still
 * counts as caught (#2489). Kills count toward the next drop only in combat. Returns the enemies
 * after the blast; explosions and drops are pushed onto the arrays given.
 */
export function applyBombBlast(
  state: StarSwarmState,
  enemies: readonly Enemy[],
  explosions: Explosion[],
  drops: PowerUp[],
  awards: ScorePoints,
  tally: { score: number; killsSinceLastDrop: number; routCaught: number }
): readonly Enemy[] {
  const scoreMult = difficultyMultiplier(state.difficulty);
  const armoredNow = carrierArmoredIn(enemies);
  return enemies.map((e) => {
    if (!e.isAlive) return e;
    // #2484: the blast rings off an escorted Carrier's force field
    if (e.tier === "Carrier" && armoredNow) return { ...e, hitFlashTimer: HIT_FLASH_DURATION };
    const newHp = e.hp - 1;
    if (newHp <= 0) {
      explosions.push(spawnExplosion(e.x, e.y));
      // #2488: the Carrier drops plating however it dies
      if (e.tier === "Carrier") drops.push(makePickup("hull", e.x, e.y, state.canvasH));
      if (e.phase === "Fleeing") tally.routCaught++; // #2489: caught is caught, even at 1×
      // no dive multiplier for bomb kills
      tally.score += award(
        awards,
        scoreSource(e.tier, "bomb"),
        Math.round(TIER_SCORE[e.tier] * scoreMult)
      );
      if (state.phase === "Playing") tally.killsSinceLastDrop++;
      return { ...e, hp: 0, isAlive: false, hitFlashTimer: 0 };
    }
    return { ...e, hp: newHp, hitFlashTimer: HIT_FLASH_DURATION };
  });
}

/**
 * The power-up drop check (Playing only, at most one power-up on screen — salvage and plating
 * don't hold the slot, #2488) and the player's collection of whatever pickup it touches: an
 * upgrade raises a ladder, a bomb blasts (`applyBombBlast`), a buddy launches, lightning or
 * shield become the active buff.
 */
export function resolvePickupCollection(
  state: StarSwarmState,
  w: CollisionWork,
  awards: ScorePoints,
  tuning: Tuning
): void {
  const { player } = state;
  // ── Power-up drop check (Playing only, max 1 on screen) ────────────────────
  // #2488: salvage crates and plating are upgrade pickups, not power-ups — they don't hold
  // the slot (#2540 review), or frequent rock salvage would starve shields and bombs.
  // #3132: a top-spawned drop arrives from off-screen — never once the wave is clear (the tick
  // of the last kill is still combat, so a roll it triggers is allowed)
  const isPowerUpDrop = (p: PowerUp) => p.type !== "salvage" && p.type !== "hull";
  if (
    arrivalsAllowed(state) &&
    w.killsSinceLastDrop >= w.dropJitterTarget &&
    !w.powerUps.some(isPowerUpDrop)
  ) {
    // #1032: X uses Math.random(), not the seeded rng (the known exception, ARCHITECTURE.md §3.2)
    const spawnX = POWERUP_W / 2 + Math.random() * (state.canvasW - POWERUP_W);
    w.powerUps = [
      ...w.powerUps, // #2488: keep any upgrade pickups already falling
      {
        id: nextId(),
        type: pickPowerUpType(state.player.lives),
        x: spawnX,
        y: POWERUP_H / 2,
        vy: POWERUP_VY,
        width: POWERUP_W,
        height: POWERUP_H,
        despawnTimer: powerUpDespawnMs(state.canvasH),
      },
    ];
    w.killsSinceLastDrop = 0;
    w.dropJitterTarget = triggerKills(state.wave) + Math.floor(rng() * 5) - 2;
  }

  // ── Player ↔ power-up collection ────────────────────────────────────────
  const collectedIdx = w.powerUps.findIndex((pu) =>
    aabb(player.x, player.y, player.width, player.height, pu.x, pu.y, pu.width, pu.height)
  );
  if (collectedIdx === -1) return;
  const collected = w.powerUps[collectedIdx]!;
  w.powerUps = w.powerUps.filter((_, i) => i !== collectedIdx);

  if (__DEV__) {
    console.log("[StarSwarm analytics]", {
      event: "powerup_collected",
      type: collected.type,
      wave: state.wave,
      livesAtCollection: player.lives,
    });
  }

  if (collected.type === "salvage") {
    // #2488: one gun level per crate; nothing at the top of the ladder (and no points)
    w.guns = Math.min(GUNS_MAX, w.guns + 1) as GunsLevel;
  } else if (collected.type === "hull") {
    w.hull = Math.min(HULL_MAX, w.hull + 1) as HullLevel;
  } else if (collected.type === "bomb") {
    // #1034: instant — clear all enemy bullets, deal 1 damage to every alive enemy
    w.bombActivated = true;
    w.bombFlashTimer = BOMB_FLASH_DURATION;
    w.rocks = w.rocks.map((a) => ({ ...a, hp: 0, shattered: true })); // #2486: the blast clears rocks too
    const tally = { score: w.score, killsSinceLastDrop: w.killsSinceLastDrop, routCaught: 0 };
    w.enemies = applyBombBlast(state, w.enemies, w.explosions, w.newDrops, awards, tally);
    w.score = tally.score;
    w.killsSinceLastDrop = tally.killsSinceLastDrop;
    if (tally.routCaught > 0) w.runStats = bumpRun(w.runStats, { routCaught: tally.routCaught });
  } else if (collected.type === "buddy") {
    // #1035/#2845: launch Buddy
    w.buddyShips = [...w.buddyShips, makeBuddy({ ...state, enemies: w.enemies }, tuning)];
    w.runStats = bumpRun(w.runStats, { buddyLaunched: 1 });
  } else {
    // lightning or shield: duration buff
    w.activePowerUp = { remainingMs: POWERUP_DURATION, type: collected.type, shieldAbsorbed: 0 };
  }
}

/**
 * Hostile projectiles ↔ rocks and Buddy, then ↔ the player. A bomb collected this tick already
 * cleared every enemy shot and released beam (#1034/#2843); the rest are spent on rocks the
 * same way the player's are (#2486), then on Buddy before the player, so a shot that reaches
 * Buddy first is spent there (#2845). The player's forgiveness circle (#974) then meets what is
 * left — bullets, a rock, a beam — and a diving or circling ship may ram (#925). The shield
 * absorbs projectiles but never a ram (#1033/#2533); hull plating takes a hit before a life does
 * (#2488); the last life ends the game. Everything it changes lands in `w`; the returned kind
 * tells `tickCollisions` which player patch to assemble.
 */
export function resolvePlayerHit(
  state: StarSwarmState,
  w: CollisionWork,
  awards: ScorePoints
): PlayerHit {
  const { player } = state;
  const scoreMult = difficultyMultiplier(state.difficulty);
  // #1033: shield absorbs enemy bullets (body collision still kills)
  const shieldActive = w.activePowerUp?.type === "shield";

  // #1034: bomb cleared all enemy bullets on activation
  let currentEnemyBullets: readonly Bullet[] = w.bombActivated ? [] : state.enemyBullets;
  // #2843: …and every released Carrier beam (enemy projectiles too); a charge on the Carrier
  // isn't a projectile yet, so it is untouched
  let carrierBeams: readonly CarrierBeam[] = w.bombActivated ? [] : state.carrierBeams;

  // #2486: enemy shots are spent on rocks the same way the player's are
  {
    const absorbed = absorbBulletsIntoRocks(currentEnemyBullets, w.rocks);
    currentEnemyBullets = absorbed.bullets;
    w.rocks = absorbed.rocks;
    if (absorbed.broken > 0)
      w.runStats = bumpRun(w.runStats, { rocksBrokenByEnemy: absorbed.broken }); // #2491
  }

  // #2845: hostiles ↔ Buddy — before the player, so a shot that reaches Buddy first is spent there
  {
    const hit = resolveBuddyHits(
      w.buddyShips,
      currentEnemyBullets,
      carrierBeams,
      w.rocks,
      w.explosions
    );
    w.buddyShips = hit.buddies;
    currentEnemyBullets = hit.enemyBullets;
    carrierBeams = hit.beams;
    if (hit.lost > 0) w.runStats = bumpRun(w.runStats, { buddyLost: hit.lost });
  }
  w.enemyBullets = currentEnemyBullets;
  w.carrierBeams = carrierBeams;

  if (player.invincibleTimer > 0) return { kind: "none" };

  // #2842: every enemy shot in flight is live — including during extraction, after the ship
  // that fired it (or the whole wave) has died. Only the wave-boundary reset removes them.
  const bulletHits = currentEnemyBullets.filter((b) =>
    collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
  );
  const hitByBullet = bulletHits.length > 0;
  // #2486: a rock on the hull is treated like a shot — the shield absorbs it, otherwise it
  // costs a life. Either way the rock shatters.
  const rockHitIdx = w.rocks.findIndex(
    (a) => a.hp > 0 && circleCircle(player.x, player.y, PLAYER_HURT_RADIUS, a.x, a.y, a.radius)
  );
  const hitByRock = rockHitIdx !== -1;
  if (hitByRock) w.rocks[rockHitIdx] = { ...w.rocks[rockHitIdx]!, hp: 0, shattered: true };
  // #2843: a released Carrier beam that reaches the ship is spent on it — shield-absorbed or
  // not — so one beam costs at most one plate or one life. Whether its Carrier still lives is
  // irrelevant: a released beam is its own entity.
  const beamHitIds = new Set(
    carrierBeams.filter((b) => beamHitsPlayer(b, player)).map((b) => b.id)
  );
  const hitByBeam = beamHitIds.size > 0;
  if (hitByBeam) w.carrierBeams = carrierBeams.filter((b) => !beamHitIds.has(b.id));

  // #1033: the shield absorbs projectiles (bullets, a rock, the beam) but never a ship
  // collision, so the ram check below runs whether or not something was absorbed this tick
  // (#2533).
  const projectileHit = hitByBullet || hitByRock || hitByBeam;
  const absorbed = projectileHit && shieldActive;
  if (absorbed) {
    // Shield absorbs the bullets — no damage.
    w.enemyBullets = currentEnemyBullets.filter(
      (b) => !collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
    );
    w.activePowerUp = {
      ...w.activePowerUp!,
      shieldAbsorbed: w.activePowerUp!.shieldAbsorbed + bulletHits.length + (hitByRock ? 1 : 0),
    };
  }

  // #956/#1029/#1030/#1077: capture the ramming enemy so we can destroy it on collision
  // Guardians collidable only in Stage 3 (guardianDeepThresholdCrossed); Elite Phase 1 always exempt
  // A projectile that already costs the life makes the ram check moot; an absorbed one doesn't.
  let rammingEnemyId: number | null = null;
  const hitByShip =
    (absorbed || !projectileHit) &&
    w.enemies.some((e) => {
      if (!e.isAlive) return false;
      if (e.tier === "Carrier") return false; // #2484: never leaves formation
      if (e.tier === "Guardian" && !state.guardianDeepThresholdCrossed) return false;
      if (e.tier === "Elite" && !state.guardianThresholdCrossed) return false;
      if (e.phase !== "Diving" && e.phase !== "Circling") return false;
      if (!collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, e.x, e.y, e.width, e.height))
        return false;
      rammingEnemyId = e.id;
      return true;
    });

  if (!hitByShip && !(projectileHit && !absorbed)) return { kind: "none" };

  // #2491/#2843: a beam that lands (plating or a life) counts once — it is spent on the
  // ship, so the same beam can never land twice
  if (hitByBeam && !absorbed) w.runStats = bumpRun(w.runStats, { beamHits: 1 });
  if (hitByShip && rammingEnemyId !== null) {
    w.enemies = w.enemies.map((e) => {
      if (e.id === rammingEnemyId) {
        w.explosions.push(spawnExplosion(e.x, e.y));
        w.score += award(
          awards,
          scoreSource(e.tier, "ram"),
          Math.round(TIER_SCORE[e.tier] * DIVE_SCORE_MULT * scoreMult)
        );
        return { ...e, hp: 0, isAlive: false };
      }
      return e;
    });
  }
  if (hitByBullet) {
    w.enemyBullets = currentEnemyBullets.filter(
      (b) => !collideCircleAABB(player.x, player.y, PLAYER_HURT_RADIUS, b.x, b.y, b.width, b.height)
    );
  }

  // #2488: hull plating takes the hit before a life does — shield → hull → life. The rammer
  // still dies and the bullet is still spent; the ship gets a short grace, not a respawn.
  if (w.hull > 0) {
    w.hull = (w.hull - 1) as HullLevel;
    w.hullFlashTimer = HIT_FLASH_DURATION;
    return { kind: "hull" };
  }

  const newLives = player.lives - 1;
  w.guns = Math.max(1, w.guns - 1) as GunsLevel; // #2488: a death costs one gun level
  w.explosions.push(spawnExplosion(player.x, player.y));
  return newLives <= 0 ? { kind: "dead" } : { kind: "life", lives: newLives };
}

// #2837: `awards` collects this tick's points by source; tick() commits them to the ledger.
export function tickCollisions(
  state: StarSwarmState,
  awards: ScorePoints = {},
  tuning: Tuning = DEFAULT_TUNING
): StarSwarmState {
  const w = openCollisionWork(state);
  // #2484: armor is judged on the tick's starting roster — an escort that dies this same tick
  // still shields the Carrier until the next one.
  const carrierArmored = carrierArmoredIn(state.enemies);

  resolvePlayerShots(state, w, awards, carrierArmored);
  resolveRockContacts(state, w, carrierArmored);
  resolvePickupCollection(state, w, awards, tuning);
  const hit = resolvePlayerHit(state, w, awards);

  switch (hit.kind) {
    case "none":
      return assembleCollisionState(state, w);
    case "hull":
      return assembleCollisionState(state, w, {
        // #2843: a beam is spent on contact, so one plate per beam needs no longer grace
        player: { invincibleTimer: Math.max(state.player.invincibleTimer, HULL_INVINCIBLE_MS) },
      });
    case "dead":
      // #2334: tick() short-circuits on GameOver (see the phase guard in wave.ts), freezing
      // whatever frame is current — including any player bullets mid-flight. Normally we'd
      // clear them here so the frozen frame doesn't render a stray bolt next to the destroyed
      // ship, but tickBonusLives (#1078) can still revive this same tick if a bonus-life
      // threshold was also just crossed — clearing unconditionally would permanently drop those
      // bullets on a rescue. Keep the (already collision-filtered) survivors here;
      // tickBonusLives finalizes the clear only if the GameOver sticks.
      return assembleCollisionState(state, w, { player: { lives: 0 }, phase: "GameOver" });
    case "life":
      return assembleCollisionState(state, w, {
        player: { lives: hit.lives, invincibleTimer: PLAYER_INVINCIBLE_MS },
      });
  }
}
