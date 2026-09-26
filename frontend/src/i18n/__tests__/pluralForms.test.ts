/**
 * Every pluralised string has every CLDR plural category its locale uses
 * (#2754, after #2638 did this for stats:metric.*). A missing one falls back to
 * English: French, Spanish and Portuguese say 1,000,000 with "many", Russian
 * 5 with "many", Arabic 2 with "two".
 */
import { NAMESPACES } from "../localeLoaders";
import { LOCALES } from "../locales";
import { localeJson, localeOnlyT, pluralBases, samplesByCategory } from "./pluralTestUtils";

describe("plural forms in every locale (#2754)", () => {
  it("finds pluralised keys outside stats", () => {
    // Guards the walk itself: an empty list would pass every check below.
    expect(pluralBases("common")).toContain("streak.pillA11y");
    expect(pluralBases("yacht")).toContain("roll.label");
    expect(pluralBases("stats")).toContain("metric.moves");
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
    const t = localeOnlyT(code, NAMESPACES);
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
