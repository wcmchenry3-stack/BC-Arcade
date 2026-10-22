/**
 * #3187: the Star Swarm "collect the power-ups" cue and its spoken label exist, translated, in
 * every locale (the three launch locales en / es / fr-CA included), with _meta for translators.
 */
import * as fs from "fs";
import * as path from "path";

const LOCALES_DIR = path.join(__dirname, "..", "locales");
const KEYS = ["phase.collectPowerUps", "a11y.collectPowerUps"] as const;
const LAUNCH = ["en", "es", "fr-CA"];

function load(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, "starswarm.json"), "utf8"));
}

const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_meta")
  .map((d) => d.name);

describe("#3187 Star Swarm collect-the-power-ups cue strings", () => {
  it("covers every launch locale", () => {
    for (const code of LAUNCH) expect(locales).toContain(code);
  });

  it.each(locales)("%s has a non-empty cue and accessible label", (locale) => {
    const strings = load(locale);
    for (const key of KEYS) {
      expect(typeof strings[key]).toBe("string");
      expect(strings[key]!.trim().length).toBeGreaterThan(0);
    }
  });

  it("the long locales stay short enough for one line on the narrowest phone (320 dp)", () => {
    // 18 px bold, worst case ~0.7 em per glyph, 10 dp gutters, shrunk to the 0.6 minimum font scale.
    const maxGlyphs = Math.floor((320 - 20) / (18 * 0.6 * 0.7));
    for (const locale of ["de", "nl", "pt", "ru"]) {
      expect(load(locale)["phase.collectPowerUps"]!.length).toBeLessThanOrEqual(maxGlyphs);
    }
  });

  it("the English cue is the on-screen command, and the label says why the game waits", () => {
    const en = load("en");
    expect(en["phase.collectPowerUps"]).toBe("COLLECT THE POWER-UPS!");
    expect(en["a11y.collectPowerUps"]).toMatch(/Collect the remaining power-ups/);
  });

  it("the translator _meta documents both keys", () => {
    const meta = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "_meta", "starswarm.meta.json"), "utf8")
    );
    for (const key of KEYS) expect(meta[key]).toBeDefined();
  });
});
