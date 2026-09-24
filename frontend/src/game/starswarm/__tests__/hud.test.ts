/**
 * #2566: the HUD splits into event-driven state (published to React only on change) and two
 * per-frame cues (shared values). These tests pin the split and the old inline render conditions.
 */
import {
  initStarSwarm,
  tick,
  CANVAS_W,
  CANVAS_H,
  POWERUP_DURATION,
  MISSION_COMPLETE_FADE_MS,
  applyPowerUp,
} from "../engine";
import { deriveHud, sameHud, hudCues, type HudExtras } from "../render/hud";
import type { StarSwarmState } from "../types";

const NONE: HudExtras = { countdownDigit: null, waveBannerCountdown: false, bonusFlash: false };

/** Mid-wave, nobody shooting or diving, player parked left and not firing. */
function quiet(wave = 1): StarSwarmState {
  let s = initStarSwarm(CANVAS_W, CANVAS_H, wave, 42, "LieutenantJG");
  for (let t = 0; t < 8000; t += 16) s = tick(s, 16, { playerX: 40, fire: false });
  return {
    ...s,
    enemyFireDisabled: true,
    asteroidsDisabled: true,
    nextDiveTimer: 1e9,
    pauseStraggler: true,
    enemyBullets: [],
    player: { ...s.player, x: 40, lives: 3, invincibleTimer: 0 },
    enemies: s.enemies.map((e) => (e.tier === "Carrier" ? { ...e, beamTimer: 1e9 } : e)),
  };
}

describe("deriveHud — the event-driven HUD", () => {
  it("carries score, wave, difficulty, ladders, lives and the loop's extras", () => {
    const s = {
      ...quiet(),
      score: 1234,
      player: { ...quiet().player, guns: 2 as const, hull: 1 as const, lives: 2 },
    };
    const hud = deriveHud(s, { countdownDigit: 3, waveBannerCountdown: true, bonusFlash: true });
    expect(hud).toMatchObject({
      score: 1234,
      wave: 1,
      difficulty: "LieutenantJG",
      guns: 2,
      hull: 1,
      lives: 2,
      countdownDigit: 3,
      waveBannerCountdown: true,
      bonusFlash: true,
    });
  });

  it("mission complete shows while its timer runs, never during a countdown or at game over", () => {
    const s = { ...quiet(), missionCompleteTimer: 500 };
    expect(deriveHud(s, NONE).missionComplete).toBe(true);
    expect(deriveHud(s, { ...NONE, countdownDigit: 2 }).missionComplete).toBe(false);
    expect(deriveHud({ ...s, phase: "GameOver" }, NONE).missionComplete).toBe(false);
    expect(deriveHud({ ...s, missionCompleteTimer: 0 }, NONE).missionComplete).toBe(false);
  });

  it("the boss-wave banner shows only while a boss wave swoops in, outside the countdown", () => {
    const swooping = initStarSwarm(CANVAS_W, CANVAS_H, 5, 42);
    expect(swooping.phase).toBe("SwoopIn");
    expect(deriveHud(swooping, NONE).bossWave).toBe(true);
    expect(deriveHud(swooping, { ...NONE, countdownDigit: 1 }).bossWave).toBe(false);
    expect(deriveHud({ ...swooping, phase: "Playing" }, NONE).bossWave).toBe(false);
    expect(deriveHud(initStarSwarm(CANVAS_W, CANVAS_H, 4, 42), NONE).bossWave).toBe(false);
  });

  it("the rout banner shows while any grunt is fleeing, outside the countdown", () => {
    const s = quiet();
    const fleeing = {
      ...s,
      enemies: s.enemies.map((e, i) => (i === 0 ? { ...e, phase: "Fleeing" as const } : e)),
    };
    expect(deriveHud(s, NONE).rout).toBe(false);
    expect(deriveHud(fleeing, NONE).rout).toBe(true);
    expect(deriveHud(fleeing, { ...NONE, countdownDigit: 3 }).rout).toBe(false);
  });

  it("game over and the duration power-up label", () => {
    expect(deriveHud({ ...quiet(), phase: "GameOver" }, NONE).gameOver).toBe(true);
    expect(deriveHud(quiet(), NONE).powerUp).toBeNull();
    expect(deriveHud(applyPowerUp(quiet(), "shield"), NONE).powerUp).toBe("shield");
    expect(deriveHud(applyPowerUp(quiet(), "lightning"), NONE).powerUp).toBe("lightning");
  });
});

describe("sameHud", () => {
  it("is true only when every field matches", () => {
    const a = deriveHud(quiet(), NONE);
    expect(sameHud(a, { ...a })).toBe(true);
    for (const [k, v] of Object.entries({
      score: 1,
      wave: 9,
      lives: 1,
      countdownDigit: 2,
      bonusFlash: true,
      rout: true,
      powerUp: "shield",
    })) {
      expect(sameHud(a, { ...a, [k]: v })).toBe(false);
    }
  });
});

describe("hudCues — the per-frame half", () => {
  it("mission opacity is 1 until the last fade window, then falls to 0", () => {
    expect(
      hudCues({ ...quiet(), missionCompleteTimer: MISSION_COMPLETE_FADE_MS * 2 }).missionOpacity
    ).toBe(1);
    expect(
      hudCues({ ...quiet(), missionCompleteTimer: MISSION_COMPLETE_FADE_MS / 2 }).missionOpacity
    ).toBeCloseTo(0.5);
    expect(hudCues({ ...quiet(), missionCompleteTimer: 0 }).missionOpacity).toBe(0);
  });

  it("the power-up bar is the remaining fraction, 0 with nothing active", () => {
    expect(hudCues(quiet()).powerUpFraction).toBe(0);
    const lit = applyPowerUp(quiet(), "lightning");
    expect(hudCues(lit).powerUpFraction).toBe(1);
    const half = {
      ...lit,
      activePowerUp: { ...lit.activePowerUp!, remainingMs: POWERUP_DURATION / 2 },
    };
    expect(hudCues(half).powerUpFraction).toBeCloseTo(0.5);
  });
});

describe("steady play — the property that removes per-frame React commits", () => {
  it("frame after frame the HUD is unchanged while the power-up cue keeps draining", () => {
    let s = applyPowerUp(quiet(), "lightning");
    let hud = deriveHud(s, NONE);
    let cue = hudCues(s).powerUpFraction;
    let hudChanges = 0;
    let cueChanges = 0;
    for (let f = 0; f < 120; f++) {
      s = tick(s, 16, { playerX: 40, fire: false });
      const next = deriveHud(s, NONE);
      if (!sameHud(hud, next)) hudChanges++;
      const c = hudCues(s).powerUpFraction;
      if (c !== cue) cueChanges++;
      hud = next;
      cue = c;
    }
    expect(s.phase).toBe("Playing");
    expect(hudChanges).toBe(0); // no React commit for two seconds of play
    expect(cueChanges).toBe(120); // the bar moved every frame, on the UI thread
  });

  it("a kill changes the HUD once (score), then it is steady again", () => {
    const s0 = quiet();
    const target = s0.enemies.find((e) => e.isAlive && e.tier === "Grunt")!;
    let s = {
      ...s0,
      playerBullets: [
        {
          id: 999,
          x: target.x,
          y: target.y,
          vx: 0,
          vy: 0,
          owner: "player" as const,
          width: 20,
          height: 20,
          damage: 10,
        },
      ],
    };
    const before = deriveHud(s, NONE);
    s = tick(s, 16, { playerX: 40, fire: false });
    const after = deriveHud(s, NONE);
    expect(sameHud(before, after)).toBe(false);
    expect(after.score).toBeGreaterThan(before.score);
    const later = deriveHud(tick(s, 16, { playerX: 40, fire: false }), NONE);
    expect(sameHud(after, later)).toBe(true);
  });
});
