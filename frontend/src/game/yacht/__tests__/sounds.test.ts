/** #3578: Yacht's sound registry. The dice roll is three synthesized variations. */
import * as fs from "fs";
import * as path from "path";
import { YACHT_DICE_ROLL, YACHT_DIE_HOLD, YACHT_DIE_RELEASE, YACHT_SOUNDS } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");
const SCREEN = fs.readFileSync(path.join(__dirname, "../../../screens/GameScreen.tsx"), "utf8");

describe("Yacht sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(YACHT_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it("the dice roll is dice-roll-1/2/3.ogg, in order, and every variation is registered", () => {
    expect(YACHT_DICE_ROLL).toHaveLength(3);
    YACHT_DICE_ROLL.forEach((key, i) => {
      expect(YACHT_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/dice-roll-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it.each([
    ["die hold", YACHT_DIE_HOLD, "die-hold"],
    ["die release", YACHT_DIE_RELEASE, "die-release"],
  ] as const)("%s is %s-1/2/3.ogg, in order", (_name, keys, file) => {
    expect(keys).toHaveLength(3);
    keys.forEach((key, i) => {
      expect(YACHT_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/${file}-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it.each(["yacht-dice-roll.ogg", "yacht-die-hold.ogg"])("the old Kenney %s is gone", (file) => {
    expect(SOURCE).not.toContain(file);
    expect(fs.existsSync(path.join(SOUNDS_DIR, file))).toBe(false);
  });

  it("the game screen plays the dice roll, hold and release through useSoundVariants", () => {
    for (const set of ["YACHT_DICE_ROLL", "YACHT_DIE_HOLD", "YACHT_DIE_RELEASE"]) {
      expect(SCREEN).toContain(`useSoundVariants(${set}, YACHT_SOUNDS)`);
    }
  });
});
