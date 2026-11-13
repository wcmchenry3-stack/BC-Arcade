/** #3775: Sudoku's sound registry ("crisp graphite") and the generator's timings, tied to motion. */
import * as fs from "fs";
import * as path from "path";
import { SOLVED_BEAT_MS, UNIT_SWEEP_MS, UNIT_SWEEP_START_MS } from "../motion";
import { SUDOKU_DIGIT_PLACE, SUDOKU_SOUNDS, soundForEvents } from "../sounds";
import type { GameEvent } from "../types";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");
const HOOK = fs.readFileSync(
  path.join(__dirname, "../../../components/sudoku/useSudokuSounds.ts"),
  "utf8"
);
const GENERATOR = fs.readFileSync(
  path.join(__dirname, "../../../../../tools/assets/synth_puzzle_sfx.py"),
  "utf8"
);
const constant = (name: string): number =>
  Number(new RegExp(`^${name} = ([0-9.]+)$`, "m").exec(GENERATOR)![1]);

describe("Sudoku sound registry (#3775)", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(SUDOKU_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it.each([
    ["sudoku.digitPlace", "sudoku-digit-place.ogg"],
    ["sudoku.digitPlace2", "sudoku-digit-place-2.ogg"],
    ["sudoku.digitPlace3", "sudoku-digit-place-3.ogg"],
    ["sudoku.errorEntered", "sudoku-error-entered.ogg"],
    ["sudoku.unitComplete", "sudoku-unit-complete.ogg"],
    ["sudoku.puzzleComplete", "sudoku-puzzle-complete.ogg"],
  ])("%s is %s", (key, file) => {
    expect(SUDOKU_SOUNDS[key]).toBeDefined();
    expect(SOURCE).toMatch(
      new RegExp(`"${key.replace(".", "\\.")}": require\\("[^"]*/${file}"\\)`)
    );
  });

  it("the place sound has three variations, in order, and nothing else is registered", () => {
    expect([...SUDOKU_DIGIT_PLACE]).toEqual([
      "sudoku.digitPlace",
      "sudoku.digitPlace2",
      "sudoku.digitPlace3",
    ]);
    expect(Object.keys(SUDOKU_SOUNDS)).toHaveLength(6);
  });

  it("is Sudoku's own: no shared card fanfare, none of the card games' invalid-move sound", () => {
    expect(SOURCE).not.toContain("hearts-moon-shot");
    expect(SOURCE).not.toContain("solitaire-invalid-move");
  });

  it("the screen plays the place tick through useSoundVariants", () => {
    expect(HOOK).toContain("useSoundVariants(SUDOKU_DIGIT_PLACE, SUDOKU_SOUNDS)");
  });

  it("the files the other games still use stay on disk", () => {
    for (const f of ["hearts-moon-shot.mp3", "solitaire-invalid-move.ogg"]) {
      expect(fs.existsSync(path.join(SOUNDS_DIR, f))).toBe(true);
    }
  });
});

describe("one sound per move (#3775)", () => {
  const unit: GameEvent = { type: "unitComplete", unit: "row", index: 3 };
  it.each([
    [undefined, null],
    [[], null],
    [[{ type: "digitPlace" }], "sudoku.digitPlace"],
    [[{ type: "digitPlace" }, { type: "errorEntered" }], "sudoku.errorEntered"],
    [[{ type: "digitPlace" }, unit], "sudoku.unitComplete"],
    [[{ type: "digitPlace" }, unit, { ...unit, unit: "col" }], "sudoku.unitComplete"],
    [[{ type: "digitPlace" }, unit, { type: "puzzleComplete" }], "sudoku.puzzleComplete"],
  ] as [readonly GameEvent[] | undefined, string | null][])("%j plays %s", (events, key) => {
    expect(soundForEvents(events)).toBe(key);
  });
});

describe("the generator's timings are the motion's (#3775)", () => {
  it("the win chord is at the solved beat, where the result card shows", () => {
    expect(constant("SUDOKU_WIN_CARD_AT") * 1000).toBe(SOLVED_BEAT_MS);
  });

  it("the unit tap run follows the sweep", () => {
    expect(constant("SUDOKU_UNIT_SWEEP_START") * 1000).toBe(UNIT_SWEEP_START_MS);
    expect(constant("SUDOKU_UNIT_SWEEP") * 1000).toBe(UNIT_SWEEP_MS);
  });
});
