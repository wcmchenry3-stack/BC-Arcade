/**
 * #3763: the Star Swarm SFX pile-ups must not clip. Pins the three lowered defaults and bounds the
 * summed (default volume x file peak) of the known pile-ups.
 *
 * FILE_PEAK holds the sample peak (linear, 0..1) of each real asset in assets/sounds, measured by
 * decoding the .ogg with ffmpeg (mono, 44.1 kHz, float) and taking max(abs(sample)). Re-measure
 * if a sound file is regenerated.
 *
 * Ceilings: summing peaks linearly assumes every peak lands on the same sample, so it is a
 * conservative upper bound on the real mix (the real peak is lower). The recorded clipping (#3763,
 * +0.4 dBFS) happened with old-default sums of about 2.44 (pile-up 1) and 2.45 (pile-up 2). The
 * ceilings sit between those old sums and the new ones (about 1.65 and 2.19), so the test fails on
 * the old defaults and catches a later bump back up. An offline re-mix of the real files with the
 * new defaults gives real peaks of -2.9 dBFS (pile-up 1) and -0.5 dBFS (pile-up 2).
 */
import { DEFAULT_SFX_VOLUMES, type SfxVolumes } from "../useStarSwarmAudio";

// Linear sample peaks of the real .ogg files (see header for how they were measured).
const FILE_PEAK = {
  bombblast: 0.9267, // starswarm-bombblast.ogg
  bonuslife: 0.8005, // starswarm-bonuslife.ogg
  beamcharge: 0.8758, // starswarm-beamcharge.ogg
  pickup: 0.7, // starswarm-pickup.ogg (plays at the powerup* volume, all 0.8)
  shieldon: 0.7871, // starswarm-shield-on.ogg
  shieldloop: 0.2844, // starswarm-shield-loop.ogg
  buddyloop: 0.1276, // starswarm-buddy-loop.ogg
  explosion: 0.7911, // starswarm-explosion.ogg
} as const;

type MixKey = keyof typeof FILE_PEAK;

// The volume key each pile-up sound is played at (pickup shares the powerup* volume).
const VOLUME_KEY: Record<MixKey, keyof SfxVolumes> = {
  bombblast: "bombblast",
  bonuslife: "bonuslife",
  beamcharge: "beamcharge",
  pickup: "powerupshield",
  shieldon: "shieldon",
  shieldloop: "shieldloop",
  buddyloop: "buddyloop",
  explosion: "explosion",
};

const PILE_UPS: { name: string; keys: MixKey[]; ceiling: number }[] = [
  {
    name: "1: bombblast + bonuslife + beamcharge",
    keys: ["bombblast", "bonuslife", "beamcharge"],
    ceiling: 2.0,
  },
  {
    name: "2: pickup + shieldon + shieldloop on top of beamcharge, buddyloop, explosion",
    keys: ["pickup", "shieldon", "shieldloop", "beamcharge", "buddyloop", "explosion"],
    ceiling: 2.3,
  },
];

const peakSum = (keys: MixKey[], vols: SfxVolumes) =>
  keys.reduce((sum, k) => sum + vols[VOLUME_KEY[k]] * FILE_PEAK[k], 0);

describe("Star Swarm SFX pile-up headroom (#3763)", () => {
  it("pins the lowered defaults", () => {
    expect(DEFAULT_SFX_VOLUMES.bombblast).toBe(0.7);
    expect(DEFAULT_SFX_VOLUMES.bonuslife).toBe(0.6);
    expect(DEFAULT_SFX_VOLUMES.beamcharge).toBe(0.6);
  });

  it.each(PILE_UPS)("pile-up $name stays under its ceiling", ({ keys, ceiling }) => {
    expect(peakSum(keys, DEFAULT_SFX_VOLUMES)).toBeLessThan(ceiling);
  });
});
