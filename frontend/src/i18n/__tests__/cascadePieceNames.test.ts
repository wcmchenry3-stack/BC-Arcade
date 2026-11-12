/**
 * Every Cascade piece name (#3695: 24 names, both capstones) has a key in every locale file and
 * its translator metadata. Untranslated locales carry the English copy, tracked in
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
  it("covers 24 distinct names", () => {
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
});
