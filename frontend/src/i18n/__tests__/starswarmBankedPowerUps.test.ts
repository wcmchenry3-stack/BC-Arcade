/**
 * #3512: the banked power-up toasts ("SHIELD → NEXT WAVE", "SHIELD UP!") and their spoken
 * announcements exist, translated, in every locale, with _meta for translators; English is the
 * owner's final copy.
 */
import * as fs from "fs";
import * as path from "path";

const LOCALES_DIR = path.join(__dirname, "..", "locales");
const POWER_UPS = ["Shield", "Lightning", "Buddy", "Bomb"] as const;
const KEYS = POWER_UPS.flatMap((p) => [
  `hud.cueBanked${p}`,
  `hud.cueApplied${p}`,
  `a11y.banked${p}`,
  `a11y.applied${p}`,
]);

function load(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, "starswarm.json"), "utf8"));
}

const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_meta")
  .map((d) => d.name);

describe("#3512 Star Swarm banked power-up strings", () => {
  it.each(locales)("%s has every toast and announcement, translated", (locale) => {
    const strings = load(locale);
    const en = load("en");
    for (const key of KEYS) {
      expect(typeof strings[key]).toBe("string");
      expect(strings[key]!.trim().length).toBeGreaterThan(0);
      if (locale !== "en") expect(`${key}: ${strings[key]}`).not.toBe(`${key}: ${en[key]}`);
    }
  });

  it("English is the owner's copy", () => {
    const en = load("en");
    expect(POWER_UPS.map((p) => en[`hud.cueBanked${p}`])).toEqual([
      "SHIELD → NEXT WAVE",
      "LIGHTNING → NEXT WAVE",
      "BUDDY → NEXT WAVE",
      "BOMB → NEXT WAVE",
    ]);
    expect(POWER_UPS.map((p) => en[`hud.cueApplied${p}`])).toEqual([
      "SHIELD UP!",
      "LIGHTNING STRIKE!",
      "BUDDY INBOUND!",
      "BOMBS AWAY!",
    ]);
    // the spoken form says it in words, not with the toast's arrow
    for (const p of POWER_UPS) expect(en[`a11y.banked${p}`]).toMatch(/next wave/);
    expect(en["a11y.collectPowerUps"]).toMatch(/carry over to the next wave/);
  });

  it("every cue fits one line on the narrowest phone (320 dp), in every locale", () => {
    // 18 px bold, worst case ~0.7 em per glyph, 10 dp gutters, shrunk to the 0.6 minimum font scale
    const maxGlyphs = Math.floor((320 - 20) / (18 * 0.6 * 0.7));
    for (const locale of locales) {
      const strings = load(locale);
      for (const key of ["phase.collectPowerUps", ...KEYS.filter((k) => k.startsWith("hud."))]) {
        expect(`${locale} ${key} ${[...strings[key]!].length <= maxGlyphs}`).toBe(
          `${locale} ${key} true`
        );
      }
    }
  });

  it("the translator _meta documents every key", () => {
    const meta = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "_meta", "starswarm.meta.json"), "utf8")
    );
    for (const key of KEYS) expect(meta[key]).toBeDefined();
  });
});
