/**
 * #3568: the player's guns stay live in the pickup wait after the last kill, and the wait holds
 * for any asteroid still on screen, so a passing rock can be cracked open for salvage. The
 * extraction (autopilot) does not fire; nothing else `weaponsFree` gates fires or spawns.
 */
import {
  initStarSwarm,
  tick,
  seedRng,
  _resetIds,
  CANVAS_W,
  CANVAS_H,
  ASTEROID_STATS,
  throwAsteroid,
  pickupWaitMaxMs,
  weaponsFree,
  arrivalsAllowed,
  playerFireAllowed,
  hazardsLive,
  isAutopilot,
  MAX_PLAYER_BULLETS,
} from "../engine";
import { powerUpDespawnMs } from "../engine/entities";
import { pickupWaitHolds, rockCrossMaxMs, tickExtractionPilot } from "../engine/extraction";
import {
  ASTEROID_ENTRY_EDGE,
  ASTEROID_MIN_ANGLE,
  ASTEROID_SPEED_MIN,
  PICKUP_WAIT_SLACK_MS,
  POWERUP_VY,
} from "../engine/tuning";
import { deriveHud, sameHud, showCollectPowerUpsCue, showCrackAsteroidsCue } from "../render/hud";
import type { Asteroid, Bullet, Phase, PowerUp, StarSwarmInput, StarSwarmState } from "../types";
import { NO_INPUT, FIRE_INPUT, advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

/** The ship parked at the left edge, out of the way of rocks placed mid-screen. */
const ASIDE: StarSwarmInput = { playerX: 40, fire: false };
const ASIDE_FIRE: StarSwarmInput = { playerX: 40, fire: true };
const HUD_EXTRAS = { countdownDigit: null, waveBannerCountdown: false, bonusFlash: false };

function makeRock(overrides: Partial<Asteroid> = {}): Asteroid {
  return {
    id: 66666,
    kind: "large",
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    radius: ASTEROID_STATS.large.radius,
    hp: ASTEROID_STATS.large.hp,
    rotation: 0,
    spin: 0,
    hitFlashTimer: 0,
    hitEnemyIds: [],
    ...overrides,
  };
}

function smallRock(overrides: Partial<Asteroid> = {}): Asteroid {
  return makeRock({
    kind: "small",
    radius: ASTEROID_STATS.small.radius,
    hp: ASTEROID_STATS.small.hp,
    ...overrides,
  });
}

function makeShot(overrides: Partial<Bullet> = {}): Bullet {
  return {
    id: 77777,
    x: 0,
    y: 0,
    vx: 0,
    vy: -0.6,
    owner: "player",
    width: 3,
    height: 10,
    damage: 1,
    ...overrides,
  };
}

function makeDrop(s: StarSwarmState, dx: number, dy: number): PowerUp {
  return {
    id: 93000,
    type: "shield",
    x: s.player.x + dx,
    y: s.player.y - dy,
    vy: POWERUP_VY,
    width: 24,
    height: 24,
    despawnTimer: 8000,
  };
}

/** A wave in combat with nobody shooting on their own and no timed rocks. */
function quietPlaying(wave = 1, canvasH = CANVAS_H): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, canvasH, wave);
  s = { ...s, enemyFireDisabled: true, asteroidsDisabled: true, flakDisabled: true };
  s = advanceMs(s, 8000);
  expect(s.phase).toBe("Playing");
  return { ...s, player: { ...s.player, invincibleTimer: 0 } };
}

/** The last-kill tick, with `extra` on screen. Returns the state after that tick. */
function lastKill(base: StarSwarmState, extra: Partial<StarSwarmState> = {}): StarSwarmState {
  const killed = {
    ...base,
    ...extra,
    enemies: base.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
  };
  return tick(killed, 16, NO_INPUT);
}

/** A wave one tick into the pickup wait, held there by a lone rock far from the ship. */
function rockWait(rock: Asteroid = smallRock({ x: 300, y: 120, vx: 0, vy: 0.05 })): StarSwarmState {
  const s = lastKill(quietPlaying(), { asteroids: [rock] });
  expect(s.phase).toBe("ClearAwaitingPickups");
  return s;
}

const at = (s: StarSwarmState, phase: Phase): StarSwarmState => ({ ...s, phase });

describe("#3568 the player's guns in the post-clear phases", () => {
  it("playerFireAllowed is true in combat and the pickup wait only; weaponsFree stays Playing-only", () => {
    const s = quietPlaying();
    const table: [Phase, boolean, boolean][] = [
      ["SwoopIn", false, false],
      ["Playing", true, true],
      ["ClearAwaitingPickups", true, false],
      ["Extraction", false, false],
      ["GameOver", false, false],
    ];
    for (const [phase, fire, free] of table) {
      expect(`${phase} fire ${playerFireAllowed(at(s, phase))}`).toBe(`${phase} fire ${fire}`);
      expect(`${phase} free ${weaponsFree(at(s, phase))}`).toBe(`${phase} free ${free}`);
    }
    // arrivals follow weaponsFree, not the player's guns
    expect(arrivalsAllowed(at(s, "ClearAwaitingPickups"))).toBe(false);
  });

  it("the guns fire in the wait: a volley spawns and the cooldown starts", () => {
    const w = rockWait();
    expect(w.playerBullets.filter((b) => b.owner === "player")).toHaveLength(0);
    const next = tick({ ...w, player: { ...w.player, shootCooldown: 0 } }, 16, ASIDE_FIRE);
    expect(next.phase).toBe("ClearAwaitingPickups");
    expect(next.playerBullets.length).toBeGreaterThan(0);
    expect(next.playerBullets.length).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
    expect(next.player.shootCooldown).toBeGreaterThan(0);
  });

  it("holding the trigger keeps firing through the wait (auto-fire)", () => {
    let s = rockWait(smallRock({ x: 300, y: 120, vx: 0, vy: 0.02 }));
    let volleys = 0;
    for (let i = 0; i < 60; i++) {
      const prev = s.player.shootCooldown;
      s = tick(s, 16, ASIDE_FIRE);
      if (s.player.shootCooldown > prev) volleys++;
    }
    expect(volleys).toBeGreaterThan(2);
  });

  it("the guns do not fire in the extraction", () => {
    const s = lastKill(quietPlaying()); // nothing on screen: straight to the extraction
    expect(s.phase).toBe("Extraction");
    expect(isAutopilot(s)).toBe(true);
    let t = s;
    for (let i = 0; i < 40 && t.phase === "Extraction"; i++) {
      t = tick({ ...t, player: { ...t.player, shootCooldown: 0 } }, 16, FIRE_INPUT);
      expect(t.playerBullets).toHaveLength(0);
    }
  });

  it("the guns do not fire while a handed-back extraction runs either (the autopilot flies)", () => {
    const s = lastKill(quietPlaying());
    const ex = s.extraction!;
    const piloted = tickExtractionPilot(s, ex, 16);
    expect(piloted.player.y).toBeLessThanOrEqual(s.player.y);
    const next = tick({ ...s, player: { ...s.player, shootCooldown: 0 } }, 16, FIRE_INPUT);
    expect(next.playerBullets).toHaveLength(0);
  });

  it("respects the 'Player missiles off' dev toggle in the wait", () => {
    const w = { ...rockWait(), playerFireDisabled: true };
    const next = tick({ ...w, player: { ...w.player, shootCooldown: 0 } }, 16, ASIDE_FIRE);
    expect(next.playerBullets).toHaveLength(0);
  });

  it("still fires in combat (unchanged)", () => {
    const s = quietPlaying();
    const next = tick({ ...s, player: { ...s.player, shootCooldown: 0 } }, 16, FIRE_INPUT);
    expect(next.playerBullets.length).toBeGreaterThan(0);
  });
});

describe("#3568 nothing else that weaponsFree gates runs in the wait", () => {
  it("no timed asteroid spawns after the last kill, however long the wait", () => {
    let s = lastKill(quietPlaying(2), {
      asteroids: [smallRock({ x: 300, y: 120, vx: 0, vy: 0.001 })],
    });
    s = { ...s, asteroidsDisabled: false, nextAsteroidTimer: 0 };
    expect(s.phase).toBe("ClearAwaitingPickups");
    const spawned = s.runStats.rocksSpawned;
    for (let i = 0; i < 300 && s.phase === "ClearAwaitingPickups"; i++) {
      s = tick(s, 16, ASIDE);
      expect(s.asteroids.length).toBeLessThanOrEqual(1);
      expect(s.runStats.rocksSpawned).toBe(spawned);
    }
  });

  it("no timed spawn in the extraction either, and the timer does not run", () => {
    let s = lastKill(quietPlaying(2));
    s = { ...s, asteroidsDisabled: false, nextAsteroidTimer: 0 };
    for (let i = 0; i < 40 && s.phase === "Extraction"; i++) {
      s = tick(s, 16, NO_INPUT);
      expect(s.asteroids).toHaveLength(0);
    }
  });

  it("a dev-panel throw does nothing in the wait or the extraction", () => {
    const w = rockWait();
    expect(throwAsteroid(w, "large")).toBe(w);
    expect(throwAsteroid(w)).toBe(w);
    const ex = lastKill(quietPlaying());
    expect(throwAsteroid(ex, "small")).toBe(ex);
  });

  it("a top-spawned ordinary power-up drop is not rolled in the wait", () => {
    const w = rockWait();
    const next = tick({ ...w, killsSinceLastDrop: 99 } as StarSwarmState, 16, ASIDE);
    expect(next.powerUps).toHaveLength(0);
  });
});

describe("#3568 the wait holds for asteroids", () => {
  it("a last kill with a rock on screen and no pickup waits instead of extracting", () => {
    const s = quietPlaying();
    const next = lastKill(s, { asteroids: [smallRock({ x: 300, y: 120, vy: 0.05 })] });
    expect(next.phase).toBe("ClearAwaitingPickups");
    expect(next.extraction).toBeNull();
    expect(next.phaseTimer).toBe(0);
    expect(next.powerUps).toHaveLength(0);
    expect(isAutopilot(next)).toBe(false);
    expect(hazardsLive(next)).toBe(true);
    expect(pickupWaitHolds(next)).toBe(true);
  });

  it("with neither a rock nor a pickup the last kill still extracts at once", () => {
    expect(lastKill(quietPlaying()).phase).toBe("Extraction");
  });

  it("the wait ends the tick the rock leaves the screen, then the extraction starts", () => {
    let s = rockWait(smallRock({ x: 300, y: CANVAS_H - 60, vx: 0, vy: 0.2 }));
    let ticks = 0;
    while (s.phase === "ClearAwaitingPickups" && ticks < 400) {
      expect(s.asteroids.length).toBeGreaterThan(0);
      s = tick(s, 16, ASIDE);
      ticks++;
    }
    expect(s.asteroids).toHaveLength(0);
    expect(s.phase).toBe("Extraction");
    expect(ticks).toBeLessThan(100);
  });

  it("the wait ends when the player breaks the rock (a small rock leaves no crate or pieces)", () => {
    const base = rockWait(smallRock({ x: 300, y: 300, hp: 1 }));
    const s = tick({ ...base, playerBullets: [makeShot({ x: 300, y: 320 })] }, 16, ASIDE);
    expect(s.asteroids).toHaveLength(0);
    expect(s.phase).toBe("Extraction");
    expect(s.waveStats.rocks.broken.player).toBe(1);
  });

  it("the player's own guns crack a rock that is crossing, in the wait", () => {
    // a slow small rock straight above the ship, and the trigger held
    let s = rockWait(smallRock({ x: 40, y: 200, vx: 0, vy: 0.02 }));
    for (let i = 0; i < 200 && s.asteroids.length > 0; i++) s = tick(s, 16, ASIDE_FIRE);
    expect(s.waveStats.rocks.broken.player).toBe(1);
    expect(s.asteroids).toHaveLength(0);
  });

  it("a cracked large rock drops salvage that joins the wait, can be collected, and carries over", () => {
    const base = rockWait(makeRock({ x: 300, y: 300, hp: 1, vx: 0, vy: 0.04 }));
    let s = tick({ ...base, playerBullets: [makeShot({ x: 300, y: 320 })] }, 16, ASIDE);
    const crate = s.powerUps.find((p) => p.type === "salvage");
    expect(crate).toBeDefined();
    // still the wait: the crate (and the pieces) hold it, the clock restarted for the crate
    expect(s.phase).toBe("ClearAwaitingPickups");
    expect(s.phaseTimer).toBe(0);
    expect(showCollectPowerUpsCue(s)).toBe(true);
    expect(showCrackAsteroidsCue(s)).toBe(false); // the pickup cue wins over the pieces
    const guns = s.player.guns;
    // fly under the crate, guns quiet, until the wait is over
    for (let i = 0; i < 2000 && s.phase === "ClearAwaitingPickups"; i++) {
      const c = s.powerUps.find((p) => p.type === "salvage");
      s = tick(s, 16, { playerX: c?.x ?? 40, fire: false });
    }
    expect(s.player.guns).toBe(guns + 1); // raised on the spot (banking, #3512, does not apply)
    expect(s.bankedPowerUp).toBeNull();
    expect(s.phase).toBe("Extraction");
    expect(s.waveStats.rocks.broken.player).toBe(1);
    // carries into the next wave
    for (let i = 0; i < 2000 && s.wave === 1; i++) s = tick(s, 16, NO_INPUT);
    expect(s.wave).toBe(2);
    expect(s.player.guns).toBe(guns + 1);
  });

  it("a stuck rock does not hold the wave past the safety cap; the reset clears it", () => {
    const stuck = smallRock({ x: 300, y: 120, vx: 0, vy: 0 });
    let s = rockWait(stuck);
    const cap = pickupWaitMaxMs(CANVAS_H);
    let waited = 16; // the kill tick
    while (s.phase === "ClearAwaitingPickups" && waited < cap + 1000) {
      s = tick(s, 16, ASIDE);
      waited += 16;
    }
    expect(s.phase).toBe("Extraction");
    expect(s.phaseTimer).toBe(0);
    expect(waited).toBeGreaterThanOrEqual(cap);
    expect(waited).toBeLessThan(cap + 64);
    // not removed by the cap itself ...
    expect(s.asteroids).toHaveLength(1);
    // ... but by the hard reset
    let t = s;
    for (let i = 0; i < 2000 && t.wave === 1; i++) t = tick(t, 16, ASIDE);
    expect(t.wave).toBe(2);
    expect(t.asteroids).toHaveLength(0);
  });

  it("a salvage yield during the extraction still hands the ship back to the wait", () => {
    // no rock at the kill: extraction; then a shot already in flight cracks a rock that
    // entered play after... build it directly: a rock and a shot appear in the extraction
    const ex = lastKill(quietPlaying());
    expect(ex.phase).toBe("Extraction");
    const s = tick(
      {
        ...ex,
        asteroids: [makeRock({ x: 60, y: 200, hp: 1 })],
        playerBullets: [makeShot({ x: 60, y: 250 })],
      },
      16,
      NO_INPUT
    );
    const t = advanceMs(s, 64);
    expect(t.powerUps.some((p) => p.type === "salvage")).toBe(true);
    expect(t.phase).toBe("ClearAwaitingPickups");
    expect(t.extraction).toBeNull();
  });
});

describe("#3568 the safety cap bounds the slowest rock", () => {
  const vyMin = ASTEROID_SPEED_MIN * Math.sin(ASTEROID_MIN_ANGLE);

  it.each([480, CANVAS_H, 960, 1366])(
    "canvas %i px: the cap is above both the pickup and the rock bound",
    (h) => {
      expect(pickupWaitMaxMs(h)).toBeGreaterThanOrEqual(powerUpDespawnMs(h) + PICKUP_WAIT_SLACK_MS);
      expect(pickupWaitMaxMs(h)).toBeGreaterThanOrEqual(rockCrossMaxMs(h) + PICKUP_WAIT_SLACK_MS);
    }
  );

  it("a rock can outlast the old pickup-only cap, which is why the cap now covers rocks", () => {
    expect(rockCrossMaxMs(CANVAS_H)).toBeGreaterThan(powerUpDespawnMs(CANVAS_H));
  });

  it.each([480, CANVAS_H, 960])(
    "canvas %i px: the slowest, steepest legal rock leaves within rockCrossMaxMs, before the cap",
    (h) => {
      const r = ASTEROID_STATS.large.radius;
      const rock = makeRock({ x: 20, y: -(r + ASTEROID_ENTRY_EDGE), vx: 0, vy: vyMin });
      const base = quietPlaying(1, h);
      let s = lastKill(base, { asteroids: [rock] });
      expect(s.phase).toBe("ClearAwaitingPickups");
      let ms = 16;
      while (s.asteroids.length > 0 && ms < 120_000) {
        s = tick(s, 16, ASIDE);
        ms += 16;
      }
      expect(s.asteroids).toHaveLength(0);
      expect(ms).toBeLessThanOrEqual(rockCrossMaxMs(h) + 32);
      expect(ms).toBeLessThan(pickupWaitMaxMs(h));
      expect(s.phase).toBe("Extraction"); // ended by the rock leaving, not by the cap
    }
  );
});

describe("#3568 accuracy stays a combat stat", () => {
  it("shots fired in the wait do not count; shots fired in combat do", () => {
    const s = quietPlaying();
    const fired = tick({ ...s, player: { ...s.player, shootCooldown: 0 } }, 16, FIRE_INPUT);
    expect(fired.waveStats.combat.shotsFired).toBeGreaterThan(0);
    const w = rockWait(smallRock({ x: 300, y: 120, vy: 0.02 }));
    const before = w.waveStats.combat.shotsFired;
    const t = tick({ ...w, player: { ...w.player, shootCooldown: 0 } }, 16, ASIDE_FIRE);
    expect(t.playerBullets.length).toBeGreaterThan(0);
    expect(t.waveStats.combat.shotsFired).toBe(before);
    expect(t.waveStats.combat.shotsHit).toBeLessThanOrEqual(t.waveStats.combat.shotsFired);
  });

  it("a whole wait of fire leaves shotsFired / shotsHit exactly as at the last kill", () => {
    let s = rockWait(smallRock({ x: 40, y: 150, vx: 0, vy: 0.01 }));
    const { shotsFired, shotsHit } = s.waveStats.combat;
    for (let i = 0; i < 120 && s.phase === "ClearAwaitingPickups"; i++) s = tick(s, 16, ASIDE_FIRE);
    expect(s.waveStats.combat.shotsFired).toBe(shotsFired);
    expect(s.waveStats.combat.shotsHit).toBe(shotsHit);
  });

  it("rocks broken after the last kill still count in rocks.broken", () => {
    const base = rockWait(smallRock({ x: 300, y: 300, hp: 1 }));
    const before = base.waveStats.rocks.broken.player;
    const s = tick({ ...base, playerBullets: [makeShot({ x: 300, y: 320 })] }, 16, ASIDE);
    expect(s.waveStats.rocks.broken.player).toBe(before + 1);
  });
});

describe("#3568 the crack-it cue selection", () => {
  const rockOnly = (): StarSwarmState => rockWait();

  it("shows only for a rock-only wait", () => {
    const s = rockOnly();
    expect(showCrackAsteroidsCue(s)).toBe(true);
    expect(showCollectPowerUpsCue(s)).toBe(false);
    const hud = deriveHud(s, HUD_EXTRAS);
    expect(hud.crackAsteroids).toBe(true);
    expect(hud.collectPowerUps).toBe(false);
  });

  it("the pickup cue wins when a pickup is out too", () => {
    const s = { ...rockOnly(), powerUps: [makeDrop(rockOnly(), 90, 300)] };
    expect(showCollectPowerUpsCue(s)).toBe(true);
    expect(showCrackAsteroidsCue(s)).toBe(false);
  });

  it("is off with no rock, in combat, in the extraction and at game over", () => {
    const s = rockOnly();
    expect(showCrackAsteroidsCue({ ...s, asteroids: [] })).toBe(false);
    expect(showCrackAsteroidsCue(at(s, "Playing"))).toBe(false);
    expect(showCrackAsteroidsCue(at(s, "Extraction"))).toBe(false);
    expect(showCrackAsteroidsCue(at(s, "GameOver"))).toBe(false);
  });

  it("is change-gated: the HUD commits when it flips, not while it holds", () => {
    const a = deriveHud(rockOnly(), HUD_EXTRAS);
    expect(sameHud(a, deriveHud(rockOnly(), HUD_EXTRAS))).toBe(true);
    const gone = deriveHud({ ...rockOnly(), asteroids: [] }, HUD_EXTRAS);
    expect(sameHud(a, gone)).toBe(false);
  });
});
