/** #3578: Yacht's sound registry. The dice roll is three synthesized variations. */
import * as fs from "fs";
import * as path from "path";
import { YACHT_DICE_ROLL, YACHT_SOUNDS } from "../sounds";

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

  it("the old Kenney dice roll is gone", () => {
    expect(SOURCE).not.toMatch(/yacht-dice-roll\.ogg/);
    expect(fs.existsSync(path.join(SOUNDS_DIR, "yacht-dice-roll.ogg"))).toBe(false);
  });

  it("the game screen plays the dice roll through useSoundVariants", () => {
    expect(SCREEN).toMatch(/useSoundVariants\(YACHT_DICE_ROLL, YACHT_SOUNDS\)/);
  });
});
