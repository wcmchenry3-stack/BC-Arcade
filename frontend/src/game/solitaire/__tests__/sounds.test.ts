/** #3563: Solitaire's sound registry. Card place is three shared, synthesized variations. */
import * as fs from "fs";
import * as path from "path";
import { SOLITAIRE_AUTO_COMPLETE, SOLITAIRE_CARD_PLACE, SOLITAIRE_SOUNDS } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("Solitaire sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(SOLITAIRE_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it("card place is card-place-1/2/3.ogg, in order, and every variation is registered", () => {
    expect(SOLITAIRE_CARD_PLACE).toHaveLength(3);
    SOLITAIRE_CARD_PLACE.forEach((key, i) => {
      expect(SOLITAIRE_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/card-place-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it("the Auto-Complete riffle is riffle-start/loop/settle.ogg", () => {
    for (const part of ["start", "loop", "settle"] as const) {
      const key = SOLITAIRE_AUTO_COMPLETE[part];
      expect(SOLITAIRE_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/riffle-${part}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    }
  });
});
