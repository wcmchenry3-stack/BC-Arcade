/**
 * #3526: the Star Swarm sound registry. Jest maps every .ogg to one stub, so file identity is
 * checked on the source text of sounds.ts; the files themselves are checked on disk.
 */
import * as fs from "fs";
import * as path from "path";
import { STARSWARM_SOUNDS } from "../sounds";
import { DEFAULT_SFX_VOLUMES } from "../../../hooks/useStarSwarmAudio";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

/** key -> file name, read from the registry source (`PICKUP` expanded). */
function keyToFile(): Record<string, string> {
  const pickup = /const PICKUP = require\("[^"]*\/([^/"]+)"\)/.exec(SOURCE)![1]!;
  const out: Record<string, string> = {};
  for (const m of SOURCE.matchAll(
    /"(starswarm\.[a-z0-9]+)":\s*(?:require\("[^"]*\/([^/"]+)"\)|(PICKUP))/g
  )) {
    out[m[1]!] = m[3] ? pickup : m[2]!;
  }
  return out;
}

const EXPECTED_KEYS = [
  "laser",
  "explosion",
  "playerhit",
  "gameover",
  "waveclear",
  "bonuslife",
  "poweruplightning",
  "powerupshield",
  "powerupbuddy",
  "powerupbomb",
  "salvage",
  "hullup",
  "bombblast",
  "shieldloop",
  "buddyloop",
  "rout",
  "guns1",
  "guns2",
  "guns3",
  "hullhit",
  "bosswave",
  "beamcharge",
  "attackrun",
  "beamfire",
  "reinforce",
  "bg1",
  "bg2",
  "bg3",
  "bg4",
].map((k) => `starswarm.${k}`);

const REMOVED_FILES = [
  "starswarm-chargeshot.ogg",
  "starswarm-powerup-buddy.ogg",
  "starswarm-powerup-shield.ogg",
  "starswarm-powerup-bomb.ogg",
  "starswarm-powerup-lightning.ogg",
];

describe("Star Swarm sound registry (#3526)", () => {
  it("every expected key resolves, and nothing else is registered", () => {
    for (const key of EXPECTED_KEYS) expect(STARSWARM_SOUNDS[key]).toBeDefined();
    expect(Object.keys(STARSWARM_SOUNDS).sort()).toEqual([...EXPECTED_KEYS].sort());
    expect(Object.keys(keyToFile()).sort()).toEqual([...EXPECTED_KEYS].sort());
  });

  it("the unused chargeshot key is gone", () => {
    expect(STARSWARM_SOUNDS["starswarm.chargeshot"]).toBeUndefined();
  });

  it("every registered file exists and no registry entry points at a removed file", () => {
    for (const file of Object.values(keyToFile())) {
      expect(fs.existsSync(path.join(SOUNDS_DIR, file))).toBe(true);
      expect(REMOVED_FILES).not.toContain(file);
    }
    for (const file of REMOVED_FILES)
      expect(fs.existsSync(path.join(SOUNDS_DIR, file))).toBe(false);
  });

  it("the six pickup keys share one file", () => {
    const files = keyToFile();
    const keys = [
      "poweruplightning",
      "powerupshield",
      "powerupbuddy",
      "powerupbomb",
      "salvage",
      "hullup",
    ];
    for (const k of keys) expect(files[`starswarm.${k}`]).toBe("starswarm-pickup.ogg");
  });

  it("the only other shared file is bosswave's", () => {
    const byFile = new Map<string, string[]>();
    for (const [key, file] of Object.entries(keyToFile())) {
      byFile.set(file, [...(byFile.get(file) ?? []), key]);
    }
    const shared = [...byFile.entries()].filter(([, keys]) => keys.length > 1).map(([f]) => f);
    expect(shared).toEqual(["starswarm-pickup.ogg"]);
    expect(byFile.get("starswarm-freefirezone.ogg")).toEqual(["starswarm.bosswave"]);
  });

  it("every SFX key has a default volume, the new ones as the owner set them", () => {
    expect(DEFAULT_SFX_VOLUMES).toMatchObject({
      bombblast: 0.8,
      shieldloop: 0.25,
      buddyloop: 0.25,
      guns: 0.7,
      attackrun: 0.7,
      rout: 0.5,
    });
  });
});
