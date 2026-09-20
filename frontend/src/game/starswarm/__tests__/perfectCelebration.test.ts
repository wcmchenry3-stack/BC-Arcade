import * as fs from "fs";
import * as path from "path";
import {
  initStarSwarm,
  tick,
  perfectBonusPoints,
  stepCelebration,
  difficultyMultiplier,
} from "../engine";
import { PERFECT_FANFARE_MS, WAVE_COUNTDOWN_MS } from "../constants";
import type { DifficultyTier } from "../types";

// #2422 — a PERFECT Free Fire Zone clear holds the game for the length of the fanfare.

describe("PERFECT_FANFARE_MS", () => {
  it("covers the fanfare asset without holding much longer than it", () => {
    // starswarm.perfectbonus -> hearts-moon-shot.mp3, a 256 kbps CBR file, so its length is
    // size / bitrate. If the asset is swapped for a longer track this fails until the constant
    // is updated, keeping the freeze and the audio ending together.
    const mp3 = path.join(__dirname, "../../../../assets/sounds/hearts-moon-shot.mp3");
    const fanfareMs = ((fs.statSync(mp3).size * 8) / 256_000) * 1000;
    expect(PERFECT_FANFARE_MS).toBeGreaterThanOrEqual(fanfareMs);
    expect(PERFECT_FANFARE_MS - fanfareMs).toBeLessThanOrEqual(500);
  });

  it("is a distinct, longer beat than the pre-wave countdown", () => {
    expect(PERFECT_FANFARE_MS).toBeGreaterThan(WAVE_COUNTDOWN_MS);
  });
});

describe("stepCelebration", () => {
  it("counts down by the elapsed time without finishing early", () => {
    expect(stepCelebration(PERFECT_FANFARE_MS, 16)).toEqual({
      remainingMs: PERFECT_FANFARE_MS - 16,
      finished: false,
    });
  });

  it("finishes exactly when the remaining time reaches zero", () => {
    expect(stepCelebration(33, 33)).toEqual({ remainingMs: null, finished: true });
  });

  it("finishes (never goes negative) when a frame overshoots the end", () => {
    expect(stepCelebration(10, 33)).toEqual({ remainingMs: null, finished: true });
  });

  it("runs the whole hold in frame-sized steps and finishes exactly once", () => {
    let remaining: number | null = PERFECT_FANFARE_MS;
    let finishedCount = 0;
    let elapsed = 0;
    while (remaining !== null) {
      const step = stepCelebration(remaining, 16);
      remaining = step.remainingMs;
      elapsed += 16;
      if (step.finished) finishedCount += 1;
    }
    expect(finishedCount).toBe(1);
    // Ends on the first frame at or past the hold length — not sooner, not a frame later.
    expect(elapsed).toBeGreaterThanOrEqual(PERFECT_FANFARE_MS);
    expect(elapsed - 16).toBeLessThan(PERFECT_FANFARE_MS);
  });
});

describe("perfectBonusPoints", () => {
  it("is 10,000 at Ensign (×1)", () => {
    expect(perfectBonusPoints("Ensign")).toBe(10_000);
  });

  it("scales with the difficulty multiplier, matching what the engine awards", () => {
    const tiers: DifficultyTier[] = ["Ensign", "LieutenantJG", "Commander", "FleetAdmiral"];
    for (const tier of tiers) {
      expect(perfectBonusPoints(tier)).toBe(Math.round(10_000 * difficultyMultiplier(tier)));
    }
  });
});

describe("engine perfect clear (unchanged by #2422)", () => {
  it("awards exactly perfectBonusPoints on top of the wave-clear and hit bonuses", () => {
    let s = initStarSwarm(360, 640, 3, 42, "Commander");
    s = {
      ...s,
      freeFireHits: 40,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    s = tick(s, 16, { playerX: 180, fire: false });
    expect(s.wave).toBe(4);
    expect(s.freeFirePerfect).toBe(true);
    // Commander ×3: waveClear round(3×500×3) + hits round(40×50×3) + perfect bonus
    expect(s.score).toBe(4500 + 6000 + perfectBonusPoints("Commander"));
  });
});
