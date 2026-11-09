/** #3578: Mahjong's sound registry. Select and match are three synthesized variations each. */
import * as fs from "fs";
import * as path from "path";
import { MAHJONG_SOUNDS, MAHJONG_TILE_MATCH, MAHJONG_TILE_SELECT } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const AUDIO = fs.readFileSync(path.join(__dirname, "../useMahjongAudio.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("Mahjong sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(MAHJONG_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it.each([
    ["select", MAHJONG_TILE_SELECT, "mahjong-select"],
    ["match", MAHJONG_TILE_MATCH, "mahjong-match"],
  ] as const)("%s is %s-1/2/3.ogg, in order", (_name, keys, file) => {
    expect(keys).toHaveLength(3);
    keys.forEach((key, i) => {
      expect(MAHJONG_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/${file}-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it.each(["mahjong-tile-select.ogg", "mahjong-tile-match.ogg", "mahjong-shuffle.ogg"])(
    "the old Kenney %s is gone",
    (file) => {
      expect(SOURCE).not.toContain(file);
      expect(fs.existsSync(path.join(SOUNDS_DIR, file))).toBe(false);
    }
  );

  it('the shuffle is the synthesized "washing the tiles"', () => {
    expect(SOURCE).toMatch(/"mahjong\.shuffle": require\("[^"]*\/mahjong-shuffle-wash\.ogg"\)/);
  });

  it("the win and deadlock are Mahjong's own synthesized sounds, not the shared files", () => {
    expect(SOURCE).toMatch(/"mahjong\.win": require\("[^"]*\/mahjong-win\.ogg"\)/);
    expect(SOURCE).toMatch(/"mahjong\.deadlock": require\("[^"]*\/mahjong-deadlock\.ogg"\)/);
    expect(SOURCE).not.toContain("hearts-moon-shot");
    expect(SOURCE).not.toContain("cascade-game-over");
  });

  it("select and match play through useSoundVariants at full volume (levels are in the files)", () => {
    expect(AUDIO).toContain("useSoundVariants(MAHJONG_TILE_SELECT, MAHJONG_SOUNDS)");
    expect(AUDIO).toContain("useSoundVariants(MAHJONG_TILE_MATCH, MAHJONG_SOUNDS)");
  });
});
