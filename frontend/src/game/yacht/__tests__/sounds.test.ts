/** #3578: Yacht's sound registry. The dice roll is three synthesized variations. */
import * as fs from "fs";
import * as path from "path";
import { CPU_JACKPOT_SOUND_MS, LOSS_BEAT_MS, TIE_BEAT_MS, WIN_BEAT_MS } from "../motion";
import { YACHT_DICE_ROLL, YACHT_DIE_HOLD, YACHT_DIE_RELEASE, YACHT_SOUNDS } from "../sounds";

const SOURCE = fs.readFileSync(path.join(__dirname, "../sounds.ts"), "utf8");
const SOUNDS_DIR = path.join(__dirname, "../../../../assets/sounds");
const SCREEN = fs.readFileSync(path.join(__dirname, "../../../screens/GameScreen.tsx"), "utf8");

describe("Yacht sound registry", () => {
  it("every registered file exists", () => {
    const files = [...SOURCE.matchAll(/require\("[^"]*\/([^/"]+)"\)/g)].map((m) => m[1]!);
    expect(files.length).toBe(Object.keys(YACHT_SOUNDS).length);
    expect(files.filter((f) => !fs.existsSync(path.join(SOUNDS_DIR, f)))).toEqual([]);
  });

  it("the dice roll is dice-roll-1/2/3.ogg, in order, and every variation is registered", () => {
    expect(YACHT_DICE_ROLL).toHaveLength(3);
    YACHT_DICE_ROLL.forEach((key, i) => {
      expect(YACHT_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/dice-roll-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it.each([
    ["die hold", YACHT_DIE_HOLD, "die-hold"],
    ["die release", YACHT_DIE_RELEASE, "die-release"],
  ] as const)("%s is %s-1/2/3.ogg, in order", (_name, keys, file) => {
    expect(keys).toHaveLength(3);
    keys.forEach((key, i) => {
      expect(YACHT_SOUNDS[key]).toBeDefined();
      const re = new RegExp(
        `"${key.replace(".", "\\.")}": require\\("[^"]*/${file}-${i + 1}\\.ogg"\\)`
      );
      expect(SOURCE).toMatch(re);
    });
  });

  it.each([
    "yacht-dice-roll.ogg",
    "yacht-die-hold.ogg",
    "yacht-straight.ogg",
    "yacht-upper-bonus.ogg",
  ])("the old Kenney %s is gone", (file) => {
    expect(SOURCE).not.toContain(file);
    expect(fs.existsSync(path.join(SOUNDS_DIR, file))).toBe(false);
  });

  it("the game screen plays the dice roll, hold and release through useSoundVariants", () => {
    for (const set of ["YACHT_DICE_ROLL", "YACHT_DIE_HOLD", "YACHT_DIE_RELEASE"]) {
      expect(SCREEN).toContain(`useSoundVariants(${set}, YACHT_SOUNDS)`);
    }
  });

  it("every scoring sound has a player and a computer key, each its own file", () => {
    const stems = [
      ["scoreCommit", "score-commit"],
      ["scoreZero", "score-zero"],
      ["smallStraight", "small-straight"],
      ["largeStraight", "large-straight"],
      ["fullHouse", "full-house"],
      ["upperBonus", "upper-bonus"],
    ];
    for (const [key, file] of stems) {
      const cpuKey = `cpu${key![0]!.toUpperCase()}${key!.slice(1)}`;
      expect(SOURCE).toMatch(new RegExp(`"yacht\\.${key}": require\\("[^"]*/${file}\\.ogg"\\)`));
      expect(SOURCE).toMatch(
        new RegExp(`"yacht\\.${cpuKey}": require\\("[^"]*/cpu-${file}\\.ogg"\\)`)
      );
    }
    expect(SOURCE).not.toMatch(/"yacht\.straight"/);
  });

  it("the jackpot is synthesized for you and the computer, no longer the shared fanfare", () => {
    expect(SOURCE).not.toContain("hearts-moon-shot");
    for (const [key, file] of [
      ["yacht", "jackpot-yacht"],
      ["joker", "jackpot-joker"],
      ["cpuYacht", "cpu-jackpot-yacht"],
      ["cpuJoker", "cpu-jackpot-joker"],
    ]) {
      expect(SOURCE).toMatch(new RegExp(`"yacht\\.${key}": require\\("[^"]*/${file}\\.ogg"\\)`));
    }
  });

  it("the end of the game (#3750) is yacht-win/loss/tie.ogg, each registered and on disk", () => {
    for (const k of ["win", "loss", "tie"]) {
      expect(SOURCE).toMatch(new RegExp(`"yacht\\.${k}": require\\("[^"]*/yacht-${k}\\.ogg"\\)`));
      expect(YACHT_SOUNDS[`yacht.${k}`]).toBeDefined();
      expect(fs.existsSync(path.join(SOUNDS_DIR, `yacht-${k}.ogg`))).toBe(true);
    }
  });

  it("the game screen plays the end sounds from the beat's onStart, not from the score events", () => {
    for (const k of ["win", "loss", "tie"]) {
      expect(SCREEN).toContain(`useSound("yacht.${k}", YACHT_SOUNDS)`);
    }
    expect(SCREEN).toContain("onStart:");
  });

  describe("the generator's timings are the motion's (#3750)", () => {
    const GENERATOR = fs.readFileSync(
      path.join(__dirname, "../../../../../tools/assets/synth_puzzle_sfx.py"),
      "utf8"
    );
    const constant = (name: string): number =>
      Number(new RegExp(`^${name} = ([0-9.]+)$`, "m").exec(GENERATOR)![1]);

    it("the win chord is at the win beat, the loss and tie chords at their beats", () => {
      expect(constant("YACHT_WIN_CARD_AT") * 1000).toBe(WIN_BEAT_MS);
      expect(constant("YACHT_END_CARD_AT") * 1000).toBe(LOSS_BEAT_MS);
      expect(constant("YACHT_END_CARD_AT") * 1000).toBe(TIE_BEAT_MS);
    });

    it("the computer's jackpot sounds are as long as the end beat waits for them", () => {
      for (const fn of ["cpu_jackpot_yacht", "cpu_jackpot_joker"]) {
        const body = GENERATOR.slice(GENERATOR.indexOf(`def ${fn}(`));
        const secs = Number(/mix\(\s*([0-9.]+),/.exec(body)![1]);
        expect(secs * 1000).toBe(CPU_JACKPOT_SOUND_MS);
      }
    });
  });
});
