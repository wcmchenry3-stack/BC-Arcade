/** #3563: FreeCell's sound registry. Card place is three shared, synthesized variations. */
import * as fs from "fs";
import * as path from "path";
import { FREECELL_AUTO_COMPLETE, FREECELL_CARD_PLACE, FREECELL_SOUNDS } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("FreeCell sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(FREECELL_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it("card place is card-place-1/2/3.ogg, in order, and every variation is registered", () => {
    expect(FREECELL_CARD_PLACE).toHaveLength(3);
    FREECELL_CARD_PLACE.forEach((key, i) => {
      expect(FREECELL_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/card-place-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it("the Auto-Complete riffle is riffle-start/loop/settle.ogg", () => {
    for (const part of ["start", "loop", "settle"] as const) {
      const key = FREECELL_AUTO_COMPLETE[part];
      expect(FREECELL_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/riffle-${part}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    }
  });
});
