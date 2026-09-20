import * as fs from "fs";
import * as path from "path";
import {
  initStarSwarm,
  tick,
  perfectBonusPoints,
  perfectHoldMs,
  difficultyMultiplier,
  FREE_FIRE_ENEMY_COUNT,
} from "../engine";
import { PERFECT_FANFARE_MS, PERFECT_SILENT_HOLD_MS, WAVE_COUNTDOWN_MS } from "../constants";
import type { DifficultyTier } from "../types";

// #2422 — a PERFECT Free Fire Zone clear holds the game for the length of the fanfare.

// Duration of an MPEG Layer III file, found by walking its frames — correct for CBR and VBR,
// and unaffected by ID3 tags (cover art included) or a trailing ID3v1 block.
const MPEG1_L3_KBPS = [32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320];
const MPEG2_L3_KBPS = [8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160];
const SAMPLE_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

function mp3DurationMs(buf: Buffer): number {
  let pos = 0;
  if (buf.toString("latin1", 0, 3) === "ID3") {
    const size = (buf[6] << 21) | (buf[7] << 14) | (buf[8] << 7) | buf[9]; // syncsafe
    pos = 10 + size + (buf[5] & 0x10 ? 10 : 0); // +10 when the tag has a footer
  }
  let ms = 0;
  while (pos + 4 <= buf.length) {
    const h = buf.readUInt32BE(pos);
    const version = (h >> 19) & 3;
    const layer = (h >> 17) & 3;
    const bitrateIdx = (h >> 12) & 15;
    const rateIdx = (h >> 10) & 3;
    const isFrame =
      h >>> 21 === 0x7ff && version !== 1 && layer === 1 && bitrateIdx > 0 && bitrateIdx < 15;
    if (!isFrame || rateIdx === 3) break;
    const mpeg1 = version === 3;
    const kbps = (mpeg1 ? MPEG1_L3_KBPS : MPEG2_L3_KBPS)[bitrateIdx - 1];
    const sampleRate = SAMPLE_RATES[version][rateIdx];
    const padding = (h >> 9) & 1;
    const frameBytes = Math.floor(((mpeg1 ? 144 : 72) * kbps * 1000) / sampleRate) + padding;
    ms += ((mpeg1 ? 1152 : 576) / sampleRate) * 1000;
    pos += frameBytes;
  }
  return ms;
}

describe("PERFECT_FANFARE_MS", () => {
  it("covers the fanfare asset without holding much longer than it", () => {
    // starswarm.perfectbonus -> hearts-moon-shot.mp3. If the asset is swapped for a longer
    // track this fails until the constant is updated, keeping the freeze and the audio
    // ending together.
    const mp3 = path.join(__dirname, "../../../../assets/sounds/hearts-moon-shot.mp3");
    const fanfareMs = mp3DurationMs(fs.readFileSync(mp3));
    expect(fanfareMs).toBeGreaterThan(9_000); // sanity: the parser really found the audio
    expect(PERFECT_FANFARE_MS).toBeGreaterThanOrEqual(fanfareMs);
    expect(PERFECT_FANFARE_MS - fanfareMs).toBeLessThanOrEqual(500);
  });

  it("is a distinct, longer beat than the pre-wave countdown", () => {
    expect(PERFECT_FANFARE_MS).toBeGreaterThan(WAVE_COUNTDOWN_MS);
  });
});

describe("perfectHoldMs", () => {
  it("holds for the full fanfare when it is playing", () => {
    expect(perfectHoldMs(true)).toBe(PERFECT_FANFARE_MS);
  });

  it("holds only a short silent beat when the fanfare is not playing (muted)", () => {
    expect(perfectHoldMs(false)).toBe(PERFECT_SILENT_HOLD_MS);
    expect(PERFECT_SILENT_HOLD_MS).toBeLessThan(PERFECT_FANFARE_MS);
  });
});

describe("FREE_FIRE_ENEMY_COUNT", () => {
  it("is what a perfect clear requires, so the spoken announcement can quote it", () => {
    let s = initStarSwarm(360, 640, 3, 42, "Ensign");
    s = {
      ...s,
      freeFireHits: FREE_FIRE_ENEMY_COUNT - 1,
      enemies: s.enemies.map((e) => ({ ...e, isAlive: false, hp: 0 })),
    };
    expect(tick(s, 16, { playerX: 180, fire: false }).freeFirePerfect).toBe(false);
    s = { ...s, freeFireHits: FREE_FIRE_ENEMY_COUNT };
    expect(tick(s, 16, { playerX: 180, fire: false }).freeFirePerfect).toBe(true);
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
