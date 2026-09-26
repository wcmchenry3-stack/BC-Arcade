/**
 * Every pluralised string has every CLDR plural category its locale uses
 * (#2754, after #2638 did this for stats:metric.*). A missing one falls back to
 * English: French, Spanish and Portuguese say 1,000,000 with "many", Russian
 * 5 with "many", Arabic 2 with "two".
 */
import i18n from "i18next";
import { NAMESPACES } from "../localeLoaders";
import { LOCALES } from "../locales";

type Strings = Record<string, string>;

const localeJson = (code: string, ns: string): Strings =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`../locales/${code}/${ns}.json`);

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

// A key is pluralised when English has its _other form.
const pluralBases = (ns: string): string[] =>
  Object.keys(localeJson("en", ns))
    .filter((k) => k.endsWith("_other"))
    .map((k) => k.replace(PLURAL_SUFFIX, ""));

// A number in each of the locale's CLDR plural categories. 0 comes last so it
// is picked only for "zero": i18next tries a _zero form for 0 in any language.
const SAMPLES = [1, 2, 3, 5, 11, 19, 21, 100, 101, 1_000_000, 1.5, 0];
const samplesByCategory = (code: string): [Intl.LDMLPluralRule, number][] => {
  const rules = new Intl.PluralRules(code);
  return rules.resolvedOptions().pluralCategories.map((category) => {
    const sample = SAMPLES.find((n) => rules.select(n) === category);
    if (sample === undefined) throw new Error(`No sample number for ${code} ${category}`);
    return [category, sample];
  });
};

// Only this locale's strings and no fallback: a missing form shows up as the key, not English.
const localeT = (code: string) => {
  const instance = i18n.createInstance();
  void instance.init({
    lng: code,
    fallbackLng: false,
    ns: [...NAMESPACES],
    resources: {
      [code]: Object.fromEntries(NAMESPACES.map((ns) => [ns, localeJson(code, ns)])),
    },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance.getFixedT(code);
};

describe("plural forms in every locale (#2754)", () => {
  it("finds pluralised keys outside stats", () => {
    // Guards the walk itself: an empty list would pass every check below.
    expect(pluralBases("common")).toContain("streak.pillA11y");
    expect(pluralBases("yacht")).toContain("roll.label");
  });

  it.each(LOCALES.map((l) => l.code))(
    "%s has every plural category for every pluralised key",
    (code) => {
      const missing = NAMESPACES.flatMap((ns) => {
        const own = localeJson(code, ns);
        return pluralBases(ns).flatMap((base) =>
          samplesByCategory(code)
            .filter(([category]) => typeof own[`${base}_${category}`] !== "string")
            .map(([category]) => `${ns}:${base}_${category}`)
        );
      });
      expect(missing).toEqual([]);
    }
  );

  it.each(LOCALES.map((l) => l.code))("%s shows each category's own form for a count", (code) => {
    const t = localeT(code);
    for (const ns of NAMESPACES) {
      for (const base of pluralBases(ns)) {
        for (const [category, count] of samplesByCategory(code)) {
          const own = t(`${ns}:${base}_${category}`, { count });
          expect([`${ns}:${base} (${count})`, t(`${ns}:${base}`, { count })]).toEqual([
            `${ns}:${base} (${count})`,
            own,
          ]);
        }
      }
    }
  });
});
