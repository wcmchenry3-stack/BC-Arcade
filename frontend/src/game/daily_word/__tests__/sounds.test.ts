/** #3665: Daily Word's sound registry. Each tile result's reveal is three synthesized variations. */
import * as fs from "fs";
import * as path from "path";
import {
  DAILY_WORD_REVEAL_CORRECT,
  DAILY_WORD_REVEAL_MISS,
  DAILY_WORD_REVEAL_PRESENT,
  DAILY_WORD_SOUNDS,
} from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const HOOK = fs.readFileSync(
  path.join(__dirname, "../../../components/daily_word/useDailyWordSounds.ts"),
  "utf8"
);
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("Daily Word sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(DAILY_WORD_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it.each([
    ["miss", DAILY_WORD_REVEAL_MISS, "daily-word-miss"],
    ["present", DAILY_WORD_REVEAL_PRESENT, "daily-word-present"],
    ["correct", DAILY_WORD_REVEAL_CORRECT, "daily-word-correct"],
  ] as const)("the %s reveal is %s-1/2/3.ogg, in order", (_name, keys, file) => {
    expect(keys).toHaveLength(3);
    keys.forEach((key, i) => {
      expect(DAILY_WORD_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/${file}-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it("the reveals play through useSoundVariants", () => {
    for (const name of ["MISS", "PRESENT", "CORRECT"]) {
      expect(HOOK).toMatch(new RegExp(`useSoundVariants\\(DAILY_WORD_REVEAL_${name}`));
    }
  });

  it("a refused guess has its own sound", () => {
    expect(SOURCE).toMatch(/"dailyWord\.refused": require\("[^"]*\/daily-word-refused\.ogg"\)/);
  });
});
