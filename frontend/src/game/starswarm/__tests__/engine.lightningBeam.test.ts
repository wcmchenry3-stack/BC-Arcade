/**
 * #3562: Lightning fires a continuous beam per gun instead of bolts. The pulse damage model, the
 * hit test (beam box vs ship boxes, beam vs rock circles), piercing, armor-piercing, rocks, one
 * beam per gun, the lifecycle (expiry, replacement, banking, extraction, the dev toggle, the
 * pickup wait), and the stats mapping. See docs/games/starswarm.md → Temporary Power-Ups.
 */
import {
  CANVAS_H,
  CANVAS_W,
  GUN_LAYOUT,
  LIGHTNING_BEAM_HALF_W,
  MAX_PLAYER_BULLETS,
  POWERUP_DURATION,
  _resetIds,
  beamHitsAabb,
  circleAlongBeam,
  initStarSwarm,
  isCarrierArmored,
  lightningBeamAt,
  lightningBeamCount,
  lightningBeamOn,
  lightningPulseDue,
  newLightningBeam,
  seedRng,
  tick,
} from "../engine";
import { makeAsteroid } from "../engine/asteroids";
import { tickCollisions } from "../engine/collisions";
import { aabb } from "../engine/geometry";
import {
  BULLET_P_VY,
  DEFAULT_TUNING,
  SPREAD_OFFSET,
  SPREAD_VX,
  SUPER_DAMAGE,
  SUPER_SHOOT_COOLDOWN,
  TWIN_OFFSET,
} from "../engine/tuning";
import type { Asteroid, Enemy, EnemyTier, GunsLevel, StarSwarmState } from "../types";
import { advanceMs } from "./helpers/engineFixtures";

beforeEach(() => {
  seedRng(42);
  _resetIds();
});

const LIT = { type: "lightning" as const, remainingMs: POWERUP_DURATION, shieldAbsorbed: 0 };
const X = 200;

/** Mid-combat, nothing shooting at the ship, no rocks, no dives, no reinforcements. */
function arena(guns: GunsLevel = 1): StarSwarmState {
  const s = advanceMs(initStarSwarm(CANVAS_W, CANVAS_H, 2, 42), 8000);
  expect(s.phase).toBe("Playing");
  return {
    ...s,
    enemyFireDisabled: true,
    enemyBullets: [],
    playerBullets: [],
    asteroids: [],
    asteroidsDisabled: true,
    nextDiveTimer: 1e9,
    reinforceTimer: 1e9,
    pauseStraggler: true,
    powerUps: [],
    buddyShips: [],
    carrierBeams: [],
    activePowerUp: LIT,
    player: { ...s.player, x: X, guns, invincibleTimer: 1e9, shootCooldown: 0 },
  };
}

interface Spot {
  readonly tier: EnemyTier;
  readonly x: number;
  readonly y: number;
  readonly hp?: number;
}

/** Only these ships alive, where given (each a ship of that tier from the wave's roster). */
function place(s: StarSwarmState, spots: readonly Spot[]): StarSwarmState {
  const used = new Set<number>();
  const placed = new Map<number, Spot>();
  for (const spot of spots) {
    const e = s.enemies.find((x) => x.tier === spot.tier && !used.has(x.id))!;
    used.add(e.id);
    placed.set(e.id, spot);
  }
  return {
    ...s,
    enemies: s.enemies.map((e): Enemy => {
      const spot = placed.get(e.id);
      if (!spot) return { ...e, isAlive: false, hp: 0 };
      const { x, y } = spot;
      // in formation at the spot (it sways about it while ticking)
      const at = { x, y, formationX: x, formationY: y, phase: "Formation" as const };
      return { ...e, ...at, isAlive: true, hp: spot.hp ?? 100, hitFlashTimer: 0 };
    }),
  };
}

const alive = (s: StarSwarmState) => s.enemies.filter((e) => e.isAlive);
const hpAt = (s: StarSwarmState, y: number) => s.enemies.find((e) => e.isAlive && e.y === y)!.hp;
/** The trigger held, the ship under the first live ship (the formation sways). */
const track = (s: StarSwarmState) => ({
  playerX: s.enemies.find((e) => e.isAlive)?.x ?? X,
  fire: true,
});
/** One collision pass with a pulse due (what `tick` hands `tickCollisions`). */
const pulse = (s: StarSwarmState) => tickCollisions(s, {}, DEFAULT_TUNING, true);
const rock = (x: number, y: number, kind: Asteroid["kind"] = "large"): Asteroid => ({
  ...makeAsteroid(kind, x, y, 0, 0),
  spin: 0,
});
const noseY = (s: StarSwarmState) => s.player.y - s.player.height / 2;

describe("the hit test (#3562)", () => {
  it("a straight beam's box test is exactly aabb on the beam's own box", () => {
    const b = { ox: 100, oy: 500, ux: 0, uy: -1, len: 400, halfW: 6 };
    for (const [x, y, w, h] of [
      [100, 300, 30, 30],
      [121, 300, 30, 30], // edge exactly touching: not a hit, as aabb
      [120.9, 300, 30, 30],
      [100, 85, 30, 30], // top edge exactly touching
      [100, 86, 30, 30],
      [60, 300, 30, 30],
    ] as const) {
      expect(beamHitsAabb(b, x, y, w, h)).toBe(aabb(100, 300, 12, 400, x, y, w, h));
    }
  });

  it("an angled beam is a rotated box: it hits along its line, not along the vertical", () => {
    const b = newLightningBeam();
    const s = { ...arena(3), asteroids: [] };
    lightningBeamAt(s, 3, [], b); // the right spread beam
    expect(b.ux).toBeGreaterThan(0);
    // a point 300 px along the beam's axis is hit, the same height straight above the gun is not
    const px = b.ox + b.ux * 300;
    const py = b.oy + b.uy * 300;
    expect(beamHitsAabb(b, px, py, 10, 10)).toBe(true);
    expect(beamHitsAabb(b, b.ox, py, 10, 10)).toBe(false);
  });

  it("a rock's centre is placed along the beam; a rock off the line is not touched", () => {
    const b = { ox: 100, oy: 500, ux: 0, uy: -1, len: 400, halfW: 6 };
    expect(circleAlongBeam(b, 100, 300, 22)).toBeCloseTo(200);
    expect(circleAlongBeam(b, 127, 300, 22)).toBeCloseTo(200); // 27 - 6 = 21 < 22: grazes it
    expect(circleAlongBeam(b, 129, 300, 22)).toBeNull();
  });
});

describe("damage per pulse (#3562)", () => {
  it("each pulse deals SUPER_DAMAGE to every ship in the column: it pierces them all", () => {
    const s = place(arena(), [
      { tier: "Elite", x: X, y: 100 },
      { tier: "Elite", x: X + 4, y: 160 },
      { tier: "Grunt", x: X - 4, y: 220 },
      { tier: "Grunt", x: X + 60, y: 220 + 1 }, // out of the column
    ]);
    const next = pulse(s);
    expect([100, 160, 220].map((y) => hpAt(next, y))).toEqual([96, 96, 96]);
    expect(hpAt(next, 221)).toBe(100);
    // no pulse due, no damage
    expect(alive(tickCollisions(s, {}, DEFAULT_TUNING, false)).map((e) => e.hp)).toEqual([
      100, 100, 100, 100,
    ]);
  });

  it("kills score and count as shot kills, and the ships above a kill are still hit", () => {
    const s = place(arena(), [
      { tier: "Grunt", x: X, y: 250, hp: 1 },
      { tier: "Elite", x: X, y: 120 },
    ]);
    const next = pulse(s);
    expect(next.enemies.find((e) => e.y === 250)!.isAlive).toBe(false);
    expect(hpAt(next, 120)).toBe(100 - SUPER_DAMAGE);
    expect(next.score).toBeGreaterThan(s.score);
    expect(next.waveStats.combat.kills.Grunt.shot).toBe(s.waveStats.combat.kills.Grunt.shot + 1);
  });

  it("is armor-piercing: the escorted Carrier takes the pulse, and no deflect is counted", () => {
    const s0 = place(arena(), [
      { tier: "Carrier", x: X, y: 80 },
      { tier: "Guardian", x: 40, y: 140 }, // an escort alive, out of the column
    ]);
    expect(isCarrierArmored(s0)).toBe(true);
    const next = pulse(s0);
    expect(next.enemies.find((e) => e.tier === "Carrier")!.hp).toBe(100 - SUPER_DAMAGE);
    expect(next.waveStats.carrier.armorDeflects).toBe(s0.waveStats.carrier.armorDeflects);
    expect(next.runStats.armorDeflects).toBe(s0.runStats.armorDeflects);
  });

  it("stops at the nearest rock on its line: the rock takes the pulse, ships beyond it don't", () => {
    const s = {
      ...place(arena(), [
        { tier: "Elite", x: X, y: 120 }, // beyond the rock
        { tier: "Grunt", x: X, y: 420 }, // between the ship and the rock
      ]),
      asteroids: [rock(X, 200), rock(X, 300)],
    };
    const next = pulse(s);
    expect(hpAt(next, 120)).toBe(100);
    expect(hpAt(next, 420)).toBe(100 - SUPER_DAMAGE);
    const [far, near] = next.asteroids;
    expect(near!.hp).toBe(6 - SUPER_DAMAGE);
    expect(near!.hitFlashTimer).toBeGreaterThan(0);
    expect(far!.hp).toBe(6);
  });

  it("breaks rocks as shots do: a large rock in two pulses, then the beam reaches past it", () => {
    let s: StarSwarmState = {
      ...place(arena(), [{ tier: "Elite", x: X, y: 120 }]),
      asteroids: [rock(X, 300)],
    };
    s = pulse(s);
    expect(s.asteroids[0]!.hp).toBe(2);
    const before = s.waveStats.rocks.broken.player;
    s = pulse(s);
    // broken: it splits into two small rocks drifting apart (settleRocks), counted as the player's
    expect(s.waveStats.rocks.broken.player).toBe(before + 1);
    expect(s.runStats.rocksBrokenByPlayer).toBeGreaterThan(0);
    expect(s.asteroids.every((a) => a.kind === "small")).toBe(true);
    expect(hpAt(s, 120)).toBe(100); // the rock still covered it on that pulse
  });
});

describe("cadence and the 5 s total (#3562)", () => {
  it("pulses on the Lightning fire clock: SUPER_SHOOT_COOLDOWN re-armed per pulse", () => {
    const s = place(arena(), [{ tier: "Elite", x: X, y: 120, hp: 10_000 }]);
    const input = { playerX: X, fire: true };
    expect(lightningPulseDue(s, 16, input)).toBe(true);
    const a = tick(s, 16, track(s));
    expect(a.player.shootCooldown).toBe(SUPER_SHOOT_COOLDOWN);
    expect(hpAt(a, 120)).toBe(10_000 - SUPER_DAMAGE);
    // the next four 16 ms ticks are inside the 70 ms clock: no pulse
    let b = a;
    for (let i = 0; i < 4; i++) {
      expect(lightningPulseDue(b, 16, input)).toBe(false);
      b = tick(b, 16, track(b));
    }
    expect(hpAt(b, 120)).toBe(10_000 - SUPER_DAMAGE);
    b = tick(b, 16, track(b));
    expect(hpAt(b, 120)).toBe(10_000 - 2 * SUPER_DAMAGE);
    // the trigger released: no pulse
    expect(lightningPulseDue(s, 16, { ...input, fire: false })).toBe(false);
  });

  it("the 5 s total equals the pre-#3562 volleys: SUPER_DAMAGE × one pulse per clock run-out", () => {
    // The pre-#3562 rule fired a Lightning bolt whenever max(0, cooldown - dt) hit 0 at the start
    // of a tick while Lightning was active, re-arming 70 ms. That bolt pierced the whole column.
    // The same frame mix as the golden replay (a dropped frame every 7th tick).
    const dtFor = (t: number) => (t % 7 === 6 ? 33 : 16);
    let cd = 0;
    let rem = POWERUP_DURATION;
    let volleys = 0;
    for (let t = 0; rem > 0; t++) {
      const dt = dtFor(t);
      if (Math.max(0, cd - dt) === 0) {
        volleys++;
        cd = SUPER_SHOOT_COOLDOWN;
      } else cd = Math.max(0, cd - dt);
      rem -= dt;
    }
    let s = place(arena(), [
      { tier: "Elite", x: X, y: 120, hp: 10_000 },
      { tier: "Elite", x: X, y: 300, hp: 10_000 },
    ]);
    // the ship tracks the sway; the trigger is released once Lightning is over
    for (let t = 0; t < 500; t++)
      s = tick(s, dtFor(t), { ...track(s), fire: s.activePowerUp !== null });
    expect(s.activePowerUp).toBeNull();
    const damage = alive(s).map((e) => 10_000 - e.hp);
    expect(damage).toEqual([volleys * SUPER_DAMAGE, volleys * SUPER_DAMAGE]);
    // ~12 a second, as the bolts were: 59 pulses with this frame mix, 236 damage per ship. The
    // same scenario on the pre-#3562 engine fired 59 bolts and dealt 236 to the nearer ship (the
    // farther one took less there: the formation swayed out from under bolts still in flight,
    // which an instant beam has no time for).
    expect(volleys).toBe(59);
  });
});

describe("one beam per gun (#3562)", () => {
  it.each([1, 2, 3] as const)("L%s: one beam per gun of playerVolley's layout", (guns) => {
    const s = arena(guns);
    const n = lightningBeamCount(s);
    expect(n).toBe(guns === 3 ? 4 : guns);
    expect(n).toBe(GUN_LAYOUT[guns].length);
    const b = newLightningBeam();
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      lightningBeamAt(s, i, [], b);
      xs.push(b.ox - X);
      expect(b.oy).toBe(noseY(s));
      expect(b.halfW).toBe(LIGHTNING_BEAM_HALF_W);
      expect(Math.hypot(b.ux, b.uy)).toBeCloseTo(1);
      // to the top of the screen
      expect(b.oy + b.uy * b.len).toBeCloseTo(0);
    }
    expect(xs).toEqual(
      guns === 1
        ? [0]
        : guns === 2
          ? [-TWIN_OFFSET, TWIN_OFFSET]
          : [-TWIN_OFFSET, TWIN_OFFSET, -SPREAD_OFFSET, SPREAD_OFFSET]
    );
  });

  it("L3's spread pair are straight lines at the spread angle", () => {
    const s = arena(3);
    const b = newLightningBeam();
    lightningBeamAt(s, 2, [], b);
    expect(b.ux / b.uy).toBeCloseTo(-SPREAD_VX / BULLET_P_VY); // leaning left
    lightningBeamAt(s, 3, [], b);
    expect(b.ux / b.uy).toBeCloseTo(SPREAD_VX / BULLET_P_VY);
  });

  it("L2's twin beams both hit a wide ship: two pulses' worth, as a twin volley did", () => {
    const next = pulse(place(arena(2), [{ tier: "Carrier", x: X, y: 120 }]));
    expect(next.enemies.find((e) => e.tier === "Carrier")!.hp).toBe(100 - 2 * SUPER_DAMAGE);
  });

  it("an angled beam hits a ship off to the side that the straight beams miss", () => {
    // the right spread beam at 300 px along its line
    const s = arena(3);
    const b = lightningBeamAt(s, 3, [], newLightningBeam());
    const x = b.ox + b.ux * 300;
    const y = b.oy + b.uy * 300;
    const next = pulse(place(s, [{ tier: "Grunt", x, y }]));
    expect(alive(next)[0]!.hp).toBe(100 - SUPER_DAMAGE);
    expect(
      pulse(place(arena(2), [{ tier: "Grunt", x, y }])).enemies.find((e) => e.isAlive)!.hp
    ).toBe(100);
  });

  it("spawns no bullets, and fires whatever the player-bullet cap holds", () => {
    const filler = Array.from({ length: MAX_PLAYER_BULLETS }, (_, i) => ({
      id: 90_000 + i,
      x: 20,
      y: 600 - i,
      vx: 0,
      vy: 0,
      owner: "player" as const,
      source: "buddy" as const,
      width: 5,
      height: 14,
      damage: 0,
    }));
    const s = { ...place(arena(3), [{ tier: "Elite", x: X, y: 120 }]), playerBullets: filler };
    const next = tick(s, 16, track(s));
    expect(next.playerBullets.length).toBeLessThanOrEqual(MAX_PLAYER_BULLETS);
    expect(next.playerBullets.every((b) => b.source === "buddy")).toBe(true);
    expect(next.enemies.find((e) => e.isAlive)!.hp).toBeLessThan(100);
  });
});

describe("lifecycle (#3562)", () => {
  const FIRE = { playerX: X, fire: true };

  it("ends exactly when Lightning expires: the pulse due on the last tick lands, none after", () => {
    let s = {
      ...place(arena(), [{ tier: "Elite", x: X, y: 120, hp: 10_000 }]),
      activePowerUp: { ...LIT, remainingMs: 10 },
    };
    s = tick(s, 16, track(s));
    expect(s.activePowerUp).toBeNull();
    expect(lightningBeamOn(s)).toBe(false);
    const hp = hpAt(s, 120);
    expect(hp).toBe(10_000 - SUPER_DAMAGE);
    // from the next tick on it is ordinary fire: one 1-damage bolt, no beam
    s = { ...s, player: { ...s.player, shootCooldown: 0 } };
    s = tick(s, 16, track(s));
    expect(s.playerBullets).toHaveLength(1);
    expect(hpAt(s, 120)).toBe(hp);
  });

  it("ends when a Shield replaces it", () => {
    const s = arena();
    const shielded = {
      ...s,
      activePowerUp: { type: "shield" as const, remainingMs: POWERUP_DURATION, shieldAbsorbed: 0 },
    };
    expect(lightningBeamOn(s)).toBe(true);
    expect(lightningBeamOn(shielded)).toBe(false);
    expect(lightningPulseDue(shielded, 16, FIRE)).toBe(false);
  });

  it("no beam while Lightning is banked (#3512)", () => {
    const s = { ...arena(), activePowerUp: null, bankedPowerUp: "lightning" as const };
    expect(lightningBeamCount(s)).toBe(0);
    const next = tick(place(s, [{ tier: "Elite", x: X, y: 120 }]), 16, FIRE);
    expect(next.playerBullets).toHaveLength(1); // ordinary fire
    expect(next.playerBullets[0]!.damage).toBe(1);
  });

  it("no beam in the extraction, the swoop-in or game over, nor with 'Player missiles off'", () => {
    const s = arena();
    for (const phase of ["Extraction", "SwoopIn", "GameOver"] as const)
      expect(lightningBeamOn({ ...s, phase })).toBe(false);
    const off = { ...s, playerFireDisabled: true };
    expect(lightningBeamOn(off)).toBe(false);
    const placed = place(off, [{ tier: "Elite", x: X, y: 120 }]);
    expect(hpAt(tick(placed, 16, FIRE), 120)).toBe(100);
  });

  it("fires in the pickup wait and breaks rocks there, but counts no shots (#3568)", () => {
    const s0 = place(arena(), []); // every ship down
    const waiting: StarSwarmState = {
      ...s0,
      phase: "ClearAwaitingPickups",
      asteroids: [rock(X, 300)],
    };
    expect(lightningBeamOn(waiting)).toBe(true);
    let s = waiting;
    for (let t = 0; t < 12; t++) s = tick(s, 16, FIRE);
    const c0 = waiting.waveStats.combat;
    const c1 = s.waveStats.combat;
    expect([c1.shotsFired, c1.shotsHit, c1.shotsOnRocks]).toEqual([
      c0.shotsFired,
      c0.shotsHit,
      c0.shotsOnRocks,
    ]);
    expect(s.waveStats.rocks.broken.player).toBeGreaterThan(waiting.waveStats.rocks.broken.player);
  });
});

describe("stats mapping (#3562)", () => {
  it("in combat: one shot fired per beam per pulse; a hit per beam that damaged a ship; a rock stop", () => {
    const s = {
      ...place(arena(3), [{ tier: "Carrier", x: X, y: 120 }]),
      asteroids: [rock(X + 40, 330)],
    };
    const c0 = s.waveStats.combat;
    const next = pulse(s);
    const c1 = next.waveStats.combat;
    expect(c1.shotsFired - c0.shotsFired).toBe(4);
    // the twin beams hit the Carrier; the right spread beam is stopped by the rock
    const b = lightningBeamAt(s, 3, s.asteroids, newLightningBeam());
    expect(b.rock).toBe(0);
    expect(c1.shotsHit - c0.shotsHit).toBe(2);
    expect(c1.shotsOnRocks - c0.shotsOnRocks).toBe(1);
  });

  it("shotsHit <= shotsFired and shotsOnRocks <= shotsFired over a whole Lightning", () => {
    let s = {
      ...place(arena(3), [
        { tier: "Elite", x: X, y: 120, hp: 10_000 },
        { tier: "Grunt", x: X - 30, y: 250, hp: 10_000 },
      ]),
      asteroids: [rock(X, 380)],
      waveStats: { ...arena(3).waveStats },
    };
    const c0 = s.waveStats.combat;
    for (let t = 0; t < 400; t++) {
      s = tick(s, 16, { playerX: X, fire: true });
      const c = s.waveStats.combat;
      expect(c.shotsHit - c0.shotsHit).toBeLessThanOrEqual(c.shotsFired - c0.shotsFired);
      expect(c.shotsOnRocks - c0.shotsOnRocks).toBeLessThanOrEqual(c.shotsFired - c0.shotsFired);
    }
    expect(s.waveStats.combat.shotsFired - c0.shotsFired).toBeGreaterThan(200);
  });
});
