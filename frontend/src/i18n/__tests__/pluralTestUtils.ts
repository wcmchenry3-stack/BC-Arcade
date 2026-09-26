/**
 * Shared by the plural-form tests (#2638, #2754): a number in each CLDR plural
 * category, and an i18next that has only one locale's strings.
 */
import i18n, { type TFunction } from "i18next";

export type Strings = Record<string, string>;

/** One locale's strings for a namespace, straight from its JSON file. */
export const localeJson = (code: string, ns: string): Strings =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require(`../locales/${code}/${ns}.json`);

/**
 * The plural keys of a namespace, without their suffix: those English has both
 * a `_one` and an `_other` form of. The same rule as check-i18n-strings.js, so
 * a plain key that happens to end in `_other` isn't taken for one.
 */
export const pluralBases = (ns: string): string[] => {
  const en = localeJson("en", ns);
  return Object.keys(en)
    .filter((k) => k.endsWith("_other"))
    .map((k) => k.slice(0, -"_other".length))
    .filter((base) => `${base}_one` in en);
};

// 0 comes last so it is picked only for "zero": i18next tries a _zero form
// for 0 in every language, so 0 as a sample for ru "many" would test _zero.
const SAMPLES = [1, 2, 3, 5, 11, 19, 21, 100, 101, 1_000_000, 1.5, 0];

/** A number in each of the locale's CLDR plural categories (fr/es/pt "many" is 1,000,000). */
export const samplesByCategory = (code: string): [Intl.LDMLPluralRule, number][] => {
  const rules = new Intl.PluralRules(code);
  return rules.resolvedOptions().pluralCategories.map((category) => {
    const sample = SAMPLES.find((n) => rules.select(n) === category);
    if (sample === undefined) throw new Error(`No sample number for ${code} ${category}`);
    return [category, sample];
  });
};

/**
 * A t with only this locale's strings for the given namespaces and no
 * fallback, so a missing key shows up as the key, not English. Fixed to the
 * locale, like useTranslation's t.
 */
export const localeOnlyT = (code: string, namespaces: readonly string[]): TFunction => {
  const instance = i18n.createInstance();
  void instance.init({
    lng: code,
    fallbackLng: false,
    ns: [...namespaces],
    defaultNS: namespaces[0],
    resources: {
      [code]: Object.fromEntries(namespaces.map((ns) => [ns, localeJson(code, ns)])),
    },
    interpolation: { escapeValue: false },
    initAsync: false,
  });
  return instance.getFixedT(code) as unknown as TFunction;
};
