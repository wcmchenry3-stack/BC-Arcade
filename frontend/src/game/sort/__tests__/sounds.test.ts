/** Sort's sound registry: every registered file exists and the keys match what ships. */
import * as fs from "fs";
import * as path from "path";
import { SORT_SOUNDS } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("Sort sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(SORT_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it("registers exactly sort.pour and sort.win", () => {
    expect(Object.keys(SORT_SOUNDS).sort()).toEqual(["sort.pour", "sort.win"]);
  });
});
