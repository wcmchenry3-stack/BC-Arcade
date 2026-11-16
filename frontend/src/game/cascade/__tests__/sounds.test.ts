/**
 * #3702: Cascade's sound registry. One set of 21 synthesized files per piece set; every registered
 * file exists, the three Kenney files are gone, the total stays under the owner's raised budget,
 * and each event picks the right file per tier.
 */
import * as fs from "fs";
import * as path from "path";
import {
  CASCADE_SOUND_NAMES,
  LAZY_CASCADE_SOUNDS,
  chainSound,
  dangerVolume,
  landSound,
  mergeSound,
  soundSetFor,
} from "../sounds";
import { MOTION } from "../motion";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

/** The owner raised Cascade's sound budget from 120 KB to about 345 KB on #3702 (both sets). */
const SOUND_BUDGET_BYTES = 350 * 1024;

/** set -> sound name -> file, read from the registry's source (Jest maps every .ogg to one stub). */
function registryFiles(): Record<string, Record<string, string>> {
  const out: Record<string, Record<string, string>> = {};
  for (const set of ["fruits", "cosmos"]) {
    const block = SOURCE.slice(SOURCE.indexOf(`${set}: {`));
    const body = block.slice(0, block.indexOf("}"));
    out[set] = {};
    for (const m of body.matchAll(/"?([\w-]+)"?: require\("[^"]*\/([^/"]+)"\)/g)) {
      out[set]![m[1]!] = m[2]!;
    }
  }
  return out;
}

describe("Cascade sound registry (#3702)", () => {
  const files = registryFiles();

  it.each(["fruits", "cosmos"])(
    "%s has all 21 sounds, each its own cascade-%s-<name>.ogg",
    (set) => {
      expect(Object.keys(files[set]!).sort()).toEqual([...CASCADE_SOUND_NAMES].sort());
      for (const name of CASCADE_SOUND_NAMES) {
        expect(files[set]![name]).toBe(`cascade-${set}-${name}.ogg`);
      }
    }
  );

  it("every registered file exists, and every Cascade file on disk is registered", () => {
    const registered = Object.values(files).flatMap((f) => Object.values(f));
    for (const f of registered) expect(fs.existsSync(path.join(SOUNDS_DIR, f))).toBe(true);
    const onDisk = fs.readdirSync(SOUNDS_DIR).filter((f) => f.startsWith("cascade-"));
    expect(onDisk.sort()).toEqual([...registered].sort());
  });

  it("the three Kenney files are gone, and nothing borrows another game's sound", () => {
    for (const f of ["cascade-fruit-merge.ogg", "cascade-combo.ogg", "cascade-game-over.ogg"]) {
      expect(fs.existsSync(path.join(SOUNDS_DIR, f))).toBe(false);
      expect(SOURCE).not.toContain(f);
    }
    expect(SOURCE).not.toMatch(/starswarm-/);
  });

  it("both sets together stay within the raised budget", () => {
    const bytes = fs
      .readdirSync(SOUNDS_DIR)
      .filter((f) => f.startsWith("cascade-"))
      .reduce((sum, f) => sum + fs.statSync(path.join(SOUNDS_DIR, f)).size, 0);
    expect(bytes).toBeLessThanOrEqual(SOUND_BUDGET_BYTES);
  });

  it("the sounds of every turn are eager (8); the rarer ones lazy or pre-warmed", () => {
    const eager = CASCADE_SOUND_NAMES.filter((n) => !LAZY_CASCADE_SOUNDS.has(n));
    expect(eager).toEqual([
      "drop",
      "land-light",
      "land-heavy",
      "merge-t0",
      "merge-t1",
      "merge-t2",
      "merge-t3",
      "chain-1",
    ]);
  });
});

describe("which file an event plays", () => {
  it("the Cosmos pieces play the Cosmos set; anything else the Fruits set", () => {
    expect(soundSetFor("cosmos")).toBe("cosmos");
    expect(soundSetFor("fruits")).toBe("fruits");
    expect(soundSetFor("unknown")).toBe("fruits");
  });

  it("land: light for tiers 0-4, heavy for 5-10, louder with the tier", () => {
    expect(landSound(0)).toEqual({ name: "land-light", volume: MOTION.sound.landVolume0 });
    expect(landSound(4).name).toBe("land-light");
    expect(landSound(5).name).toBe("land-heavy");
    expect(landSound(10)).toEqual({ name: "land-heavy", volume: 1 });
    for (let t = 1; t <= 10; t++) {
      expect(landSound(t).volume).toBeGreaterThan(landSound(t - 1).volume);
    }
  });

  it("merge: the pre-pitched file of the tier made, clamped to the ladder", () => {
    for (let t = 0; t <= 10; t++) expect(mergeSound(t)).toBe(`merge-t${t}`);
    expect(mergeSound(-1)).toBe("merge-t0");
    expect(mergeSound(12)).toBe("merge-t10");
  });

  it("chain: link 2 is chain-1, rising to chain-4 from link 5 on; a plain merge has none", () => {
    expect(chainSound(1)).toBeNull();
    expect([2, 3, 4, 5, 9].map(chainSound)).toEqual([
      "chain-1",
      "chain-2",
      "chain-3",
      "chain-4",
      "chain-4",
    ]);
  });

  it("danger: soft as the count starts, full at its end", () => {
    expect(dangerVolume(0)).toBeCloseTo(MOTION.sound.dangerVolume0);
    expect(dangerVolume(0.5)).toBeGreaterThan(dangerVolume(0.2));
    expect(dangerVolume(1)).toBe(1);
    expect(dangerVolume(7)).toBe(1);
  });
});
