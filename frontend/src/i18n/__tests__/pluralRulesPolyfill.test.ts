/**
 * The Intl.PluralRules polyfill (#2754). Hermes, the engine on iOS and
 * Android, has no Intl.PluralRules; without one i18next uses English's
 * one/other in every language. Node has it, so these tests remove it first.
 */
import { LOCALES } from "../locales";
import { localeJson, localeOnlyT } from "./pluralTestUtils";

const NATIVE = Intl.PluralRules;

const setPluralRules = (value: typeof Intl.PluralRules | undefined) => {
  if (value === undefined) {
    delete (Intl as { PluralRules?: unknown }).PluralRules;
  } else {
    Object.defineProperty(Intl, "PluralRules", { value, writable: true, configurable: true });
  }
};

const loadPolyfill = () =>
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require("../pluralRulesPolyfill");
  });

// Whole numbers that tell the categories apart, including large ones
// (fr "many" at 1,000,000; ar "few" at 1,003 and "many" at 1,011). Every count
// the app pluralises is whole; the polyfill gets some fractions wrong (see
// pluralRulesPolyfill.ts), so they aren't compared.
const NUMBERS = [0, 1, 2, 3, 4, 5, 10, 11, 12, 21, 22, 25, 99, 100, 101, 102, 111];
const LARGE = [1000, 1001, 1002, 1003, 1005, 1011, 1_000_000, 2_000_000, 1_000_001];

afterEach(() => setPluralRules(NATIVE));

it("leaves a native Intl.PluralRules alone", () => {
  loadPolyfill();
  expect(Intl.PluralRules).toBe(NATIVE);
});

describe("on an engine without Intl.PluralRules, like Hermes", () => {
  beforeEach(() => {
    setPluralRules(undefined);
    expect("PluralRules" in Intl).toBe(false);
    loadPolyfill();
  });

  it("installs one", () => {
    expect(typeof Intl.PluralRules).toBe("function");
    expect(Intl.PluralRules).not.toBe(NATIVE);
  });

  it.each(LOCALES.map((l) => l.code))("gives %s the native categories and choices", (code) => {
    const polyfill = new Intl.PluralRules(code);
    const native = new NATIVE(code);
    expect([...polyfill.resolvedOptions().pluralCategories].sort()).toEqual(
      [...native.resolvedOptions().pluralCategories].sort()
    );
    for (const n of [...NUMBERS, ...LARGE]) {
      expect([n, polyfill.select(n)]).toEqual([n, native.select(n)]);
    }
  });

  it.each([
    // [locale, namespace, key, count, form]
    ["ru", "yacht", "roll.label", 0, "many"],
    ["ru", "yacht", "roll.label", 2, "few"],
    ["ru", "yacht", "roll.label", 1, "one"],
    ["ar", "yacht", "roll.label", 0, "zero"],
    ["ar", "yacht", "roll.label", 2, "two"],
    ["ar", "yacht", "roll.label", 3, "few"],
    ["ar", "yacht", "roll.label", 11, "many"],
    ["ar", "yacht", "roll.label", 100, "other"],
    ["he", "common", "streak.pillA11y", 2, "two"],
    ["he", "common", "streak.pillA11y", 3, "other"],
    ["fr-CA", "result", "margin.won", 1_000_000, "many"],
    ["fr-CA", "result", "margin.won", 0, "one"],
    ["es", "result", "margin.won", 1_000_000, "many"],
    ["pt", "result", "margin.won", 1_000_000, "many"],
  ])("i18next shows %s %s:%s for %d in its %s form", (code, ns, key, count, form) => {
    const t = localeOnlyT(code, [ns]);
    const expected = localeJson(code, ns)[`${key}_${form}`];
    expect(expected).toBeDefined();
    expect(t(`${ns}:${key}`, { count })).toBe(expected!.replace("{{count}}", String(count)));
  });
});
