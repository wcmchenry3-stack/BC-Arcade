/** #3563: Hearts's sound registry. Card place is three shared, synthesized variations. */
import * as fs from "fs";
import * as path from "path";
import { HEARTS_CARD_PLAY, HEARTS_SOUNDS, HEARTS_TRICK_WON } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("Hearts sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(HEARTS_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it("card place is card-place-1/2/3.ogg, in order, and every variation is registered", () => {
    expect(HEARTS_CARD_PLAY).toHaveLength(3);
    HEARTS_CARD_PLAY.forEach((key, i) => {
      expect(HEARTS_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/card-place-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it("trick gathered is trick-gathered-1/2/3.ogg, in order, and every variation is registered", () => {
    expect(HEARTS_TRICK_WON).toHaveLength(3);
    HEARTS_TRICK_WON.forEach((key, i) => {
      expect(HEARTS_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/trick-gathered-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });
});
