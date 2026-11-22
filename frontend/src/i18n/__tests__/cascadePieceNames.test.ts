/**
 * Every Cascade piece name (#3695; #3960: 24 names, both capstones) has a key in every locale file and
 * its translator metadata. Names not yet translated carry the English copy, tracked in
 * scripts/i18n-english-copies.json (see docs/I18N.md).
 */
import * as fs from "fs";
import * as path from "path";

import { TIERS } from "../../game/cascade/tiers";
import { FRUIT_SETS } from "../../theme/fruitSets";

const LOCALES_DIR = path.resolve(__dirname, "../locales");
const localeDirs = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((d) => d.isDirectory() && d.name !== "_meta")
  .map((d) => d.name);

const keys = TIERS.flatMap((t) => [
  `pieces.fruits.${t.nameKeys.fruits}`,
  `pieces.cosmos.${t.nameKeys.cosmos}`,
]);

const read = (file: string): Record<string, string> =>
  JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;

describe("Cascade piece names", () => {
  it("covers 24 distinct names (#3960: 12 tiers x 2 sets)", () => {
    expect(new Set(keys).size).toBe(24);
  });

  it.each(localeDirs)("%s has every piece name key", (locale) => {
    const cascade = read(path.join(LOCALES_DIR, locale, "cascade.json"));
    for (const key of keys) {
      expect(typeof cascade[key]).toBe("string");
      expect(cascade[key]!.length).toBeGreaterThan(0);
    }
  });

  it("English matches the fruit-set names, and the metadata has every key", () => {
    const en = read(path.join(LOCALES_DIR, "en", "cascade.json"));
    const meta = read(path.join(LOCALES_DIR, "_meta", "cascade.meta.json"));
    for (const set of Object.values(FRUIT_SETS)) {
      for (const f of set.fruits) {
        expect(en[`pieces.${f.i18nKey}`]).toBe(f.name);
        expect(meta[`pieces.${f.i18nKey}`]).toBeDefined();
      }
    }
  });

  describe("translated names (#3965)", () => {
    const TRANSLATED = [
      "pieces.fruits.lychee",
      "pieces.fruits.lime",
      "pieces.fruits.plum",
      "pieces.fruits.pomegranate",
      "pieces.cosmos.moon",
    ];
    const copies = JSON.parse(
      fs.readFileSync(path.resolve(__dirname, "../../../scripts/i18n-english-copies.json"), "utf8")
    ) as {
      accepted: Record<string, Record<string, string[]>>;
      pending: Record<string, Record<string, string[]>>;
    };
    const nonEnglish = localeDirs.filter((l) => l !== "en");

    it.each(nonEnglish)("%s: the five names are real translations, not pending", (locale) => {
      const cascade = read(path.join(LOCALES_DIR, locale, "cascade.json"));
      const en = read(path.join(LOCALES_DIR, "en", "cascade.json"));
      const pending = copies.pending.cascade?.[locale] ?? [];
      const accepted = copies.accepted.cascade?.[locale] ?? [];
      for (const key of TRANSLATED) {
        expect(pending).not.toContain(key);
        if (cascade[key] === en[key]) {
          // The word really is the same in that language (Dutch "Lychee", French "Lime").
          expect(accepted).toContain(key);
        }
      }
    });

    it.each(nonEnglish)("%s: Lime and Lemon are different words", (locale) => {
      const cascade = read(path.join(LOCALES_DIR, locale, "cascade.json"));
      expect(cascade["pieces.fruits.lime"]).not.toBe(cascade["pieces.fruits.lemon"]);
    });

    it("no Cascade names are left pending in any locale (#3983)", () => {
      expect(copies.pending.cascade).toBeUndefined();
    });

    it.each(nonEnglish)("%s: every piece name is a real translation (#3983)", (locale) => {
      const cascade = read(path.join(LOCALES_DIR, locale, "cascade.json"));
      const en = read(path.join(LOCALES_DIR, "en", "cascade.json"));
      const accepted = copies.accepted.cascade?.[locale] ?? [];
      for (const key of keys) {
        if (cascade[key] === en[key]) {
          // Same word in that language (German "Mars", French "Neptune") is reviewed, not pending.
          // Cherry/Orange/Apple/Pineapple/Watermelon are glossary terms kept in English.
          const glossaryKept = ["cherry", "orange", "apple", "pineapple", "watermelon"].some(
            (f) => key === `pieces.fruits.${f}`
          );
          if (!glossaryKept) expect(accepted).toContain(key);
        }
      }
    });

    it.each(localeDirs)("%s: retired Blueberry, Grape and Coconut names are gone", (locale) => {
      const cascade = read(path.join(LOCALES_DIR, locale, "cascade.json"));
      for (const retired of ["blueberry", "grape", "coconut"]) {
        expect(cascade[`pieces.fruits.${retired}`]).toBeUndefined();
      }
    });
  });
});
