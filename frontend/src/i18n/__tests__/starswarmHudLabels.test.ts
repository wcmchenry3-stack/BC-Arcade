/**
 * #3598: the redesigned Star Swarm HUD's new strings — the SCORE / BEST / WAVE captions and the
 * power-up timer's names — exist, translated, in every locale, and fit their slots.
 */
import * as fs from "fs";
import * as path from "path";

const LOCALES_DIR = path.join(__dirname, "..", "locales");
const CAPTIONS = ["hud.scoreLabel", "hud.bestLabel", "hud.waveLabel"] as const;
const POWER_UPS = ["hud.powerUpShield", "hud.powerUpLightning"] as const;
const KEYS = [...CAPTIONS, ...POWER_UPS];

function load(locale: string): Record<string, string> {
  return JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, locale, "starswarm.json"), "utf8"));
}

const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_meta")
  .map((d) => d.name);

/** Characters as the reader sees them (a Devanagari vowel sign is not a character of its own). */
const graphemes = (s: string) => [...new Intl.Segmenter().segment(s)].length;

describe("#3598 Star Swarm HUD captions and power-up names", () => {
  it.each(locales)("%s has every new string, non-empty, with no placeholder", (locale) => {
    const strings = load(locale);
    for (const key of KEYS) {
      expect(typeof strings[key]).toBe("string");
      expect(strings[key]!.trim().length).toBeGreaterThan(0);
      expect(strings[key]).not.toMatch(/\{\{/);
    }
  });

  it.each(locales)("%s strings fit one HUD line (10 characters at most)", (locale) => {
    const strings = load(locale);
    for (const key of KEYS) expect(graphemes(strings[key]!)).toBeLessThanOrEqual(10);
  });

  it.each(locales)("%s captions are the words its HUD values already use", (locale) => {
    const s = load(locale);
    expect(s["hud.scoreValue"]).toContain(s["hud.scoreLabel"]);
    expect(s["hud.bestValue"]).toContain(s["hud.bestLabel"]);
    expect(s["hud.waveValue"]).toContain(s["hud.waveLabel"]);
  });

  it.each(locales)("%s power-up names match its banked-power-up toasts", (locale) => {
    const s = load(locale);
    expect(s["hud.cueBankedShield"]).toContain(s["hud.powerUpShield"]);
    expect(s["hud.cueBankedLightning"]).toContain(s["hud.powerUpLightning"]);
  });

  it("English is the H1-A copy", () => {
    const en = load("en");
    expect(KEYS.map((k) => en[k])).toEqual(["SCORE", "BEST", "WAVE", "SHIELD", "LIGHTNING"]);
  });

  it("the translator _meta documents every new key within its limit", () => {
    const meta = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, "_meta", "starswarm.meta.json"), "utf8")
    );
    for (const key of KEYS) {
      expect(meta[key]).toBeDefined();
      expect(meta[key].characterLimit).toBeLessThanOrEqual(10);
      expect(meta[key].placeholders).toEqual([]);
    }
  });
});
