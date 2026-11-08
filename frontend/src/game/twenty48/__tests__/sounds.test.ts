/** #3578: 2048's sound registry. Merge and spawn are three synthesized variations each. */
import * as fs from "fs";
import * as path from "path";
import { TWENTY48_SOUNDS, TWENTY48_TILE_MERGE, TWENTY48_TILE_SPAWN } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");
const SCREEN = fs.readFileSync(path.join(__dirname, "../../../screens/Twenty48Screen.tsx"), "utf8");

describe("2048 sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(TWENTY48_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it.each([
    ["merge", TWENTY48_TILE_MERGE, "tile-merge"],
    ["spawn", TWENTY48_TILE_SPAWN, "tile-spawn"],
  ] as const)("%s is %s-1/2/3.ogg, in order", (_name, keys, file) => {
    expect(keys).toHaveLength(3);
    keys.forEach((key, i) => {
      expect(TWENTY48_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/${file}-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it.each(["twenty48-tile-merge.ogg", "twenty48-tile-spawn.ogg"])(
    "the old Kenney %s is gone",
    (file) => {
      expect(SOURCE).not.toContain(file);
      expect(fs.existsSync(path.join(SOUNDS_DIR, file))).toBe(false);
    }
  );

  it("the screen plays merge and spawn through useSoundVariants at full volume (levels are in the files)", () => {
    expect(SCREEN).toContain("useSoundVariants(TWENTY48_TILE_MERGE, TWENTY48_SOUNDS)");
    expect(SCREEN).toContain("useSoundVariants(TWENTY48_TILE_SPAWN, TWENTY48_SOUNDS)");
  });
});
