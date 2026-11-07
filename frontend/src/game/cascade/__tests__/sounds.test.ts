/** #3526: Cascade's combo sound is its own file, not a Star Swarm one (Star Swarm's were replaced). */
import * as fs from "fs";
import * as path from "path";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");

describe("Cascade sound registry", () => {
  it("no entry points at a starswarm-* file", () => {
    expect(SOURCE).not.toMatch(/starswarm-/);
  });

  it("cascade.cascadeCombo is cascade-combo.ogg, and every registered file exists", () => {
    expect(SOURCE).toMatch(/"cascade\.cascadeCombo": require\("[^"]*\/cascade-combo\.ogg"\)/);
    for (const m of SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)) {
      expect(fs.existsSync(path.join(SOUNDS_DIR, m[1]!))).toBe(true);
    }
  });
});
