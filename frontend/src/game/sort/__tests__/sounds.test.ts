/** Sort's sound registry (#3661): every registered file exists and the keys match what ships. */
import * as fs from "fs";
import * as path from "path";
import { SORT_POUR_LIFT, SORT_POUR_STREAM, SORT_SELECT, SORT_SOUNDS } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const AUDIO = fs.readFileSync(path.join(__dirname, "../useSortAudio.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("Sort sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(SORT_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it("registers the three variations of each frequent sound and one file for the rest", () => {
    expect(Object.keys(SORT_SOUNDS).sort()).toEqual(
      [
        ...SORT_SELECT,
        ...SORT_POUR_LIFT,
        ...SORT_POUR_STREAM.flat(),
        "sort.refused",
        "sort.complete",
        "sort.undo",
        "sort.hint",
        "sort.win",
      ].sort()
    );
  });

  it.each([
    ["select", SORT_SELECT, "sort-select"],
    ["pour lift", SORT_POUR_LIFT, "sort-pour-lift"],
    ...SORT_POUR_STREAM.map(
      (keys, u) => [`pour stream, ${u + 1} unit(s)`, keys, `sort-pour-stream-${u + 1}u`] as const
    ),
  ] as const)("%s is %s-1/2/3.ogg, in order", (_name, keys, file) => {
    expect(keys).toHaveLength(3);
    keys.forEach((key, i) => {
      expect(SORT_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/${file}-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it.each([
    ["sort.refused", "sort-refused.ogg"],
    ["sort.complete", "sort-complete.ogg"],
    ["sort.undo", "sort-undo.ogg"],
    ["sort.hint", "sort-hint.ogg"],
    ["sort.win", "sort-win.ogg"],
  ])("%s is Sort's own %s", (key, file) => {
    expect(SOURCE).toMatch(
      new RegExp(`"${key.replace(".", "\\.")}": require\\("[^"]*/${file}"\\)`)
    );
  });

  it("no longer borrows Cascade's or FreeCell's files (both stay for their own games)", () => {
    expect(SOURCE).not.toContain("cascade-fruit-merge");
    expect(SOURCE).not.toContain("freecell-game-win");
    expect(fs.existsSync(path.join(SOUNDS_DIR, "cascade-fruit-merge.ogg"))).toBe(true);
    expect(fs.existsSync(path.join(SOUNDS_DIR, "freecell-game-win.mp3"))).toBe(true);
  });

  it("has one stream per unit count 1 to 4, three variations each", () => {
    expect(SORT_POUR_STREAM).toHaveLength(4);
    SORT_POUR_STREAM.forEach((keys) => expect(keys).toHaveLength(3));
    expect(SOURCE).not.toMatch(/glug/i);
    expect(fs.readdirSync(SOUNDS_DIR).filter((f) => f.startsWith("sort-pour-glug"))).toEqual([]);
  });

  it("the frequent sounds play through useSoundVariants", () => {
    expect(AUDIO).toContain("useSoundVariants(SORT_SELECT, SORT_SOUNDS)");
    expect(AUDIO).toContain("useSoundVariants(SORT_POUR_LIFT, SORT_SOUNDS)");
    for (let u = 0; u < 4; u++) {
      expect(AUDIO).toContain(`useSoundVariants(SORT_POUR_STREAM[${u}], SORT_SOUNDS)`);
    }
  });
});
