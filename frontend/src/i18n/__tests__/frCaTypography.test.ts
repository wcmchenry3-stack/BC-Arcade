/**
 * fr-CA typography and Québec usage (#3152).
 *
 * Québec French (OQLF) puts a no-break space before ":" but, unlike fr-FR,
 * none before ";", "!" or "?". Quotes are « » with no-break spaces inside.
 * Scans every fr-CA locale value so the rules can't regress; also checks that
 * numbers formatted for fr-CA come out as "1 234,56".
 */
import fs from "fs";
import path from "path";
import type { TFunction } from "i18next";

import { formatNumber } from "../../api/statsDisplay";

const DIR = path.join(__dirname, "..", "locales", "fr-CA");

const entries: Array<[string, string]> = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") entries.push([`${file.replace(/\.json$/, "")}.${key}`, value]);
  }
}

function offenders(re: RegExp): string[] {
  return entries.filter(([, v]) => re.test(v)).map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
}

describe("fr-CA typography (#3152)", () => {
  it("scans a non-trivial number of strings", () => {
    expect(entries.length).toBeGreaterThan(500);
  });

  it("has no space before ; ! ? (unlike fr-FR)", () => {
    // ": ?" (a hidden-value placeholder) is exempt: the space follows the colon.
    expect(offenders(/(?<!:)[ \u00a0\u202f]+[;!?]/)).toEqual([]);
  });

  it("has a no-break space before every colon that introduces text", () => {
    // Colons followed by a space or the end (not times or URLs).
    expect(offenders(/(?<!\u00a0):(?=[ \u00a0]|$)/)).toEqual([]);
    expect(offenders(/ :(?=[ \u00a0]|$)/)).toEqual([]);
    expect(offenders(/\u202f:/)).toEqual([]);
  });

  it("uses « » with no-break spaces, never straight or curly double quotes", () => {
    expect(offenders(/["\u201c\u201d]/)).toEqual([]);
    expect(offenders(/«(?!\u00a0)/)).toEqual([]);
    expect(offenders(/(?<!\u00a0)»/)).toEqual([]);
  });

  it("puts a no-break space before %", () => {
    expect(offenders(/(?<!\u00a0)%/)).toEqual([]);
  });

  it("uses Québec vocabulary", () => {
    expect(offenders(/\be-?mail\b|\bmail\b|week-?end|\bparking\b|\bshopping\b/i)).toEqual([]);
    expect(offenders(/\bscores?\b/i).filter((s) => !s.includes("{{"))).toEqual([]);
  });
});

describe("fr-CA number formatting (#3152)", () => {
  const t = { lng: "fr-CA" } as unknown as TFunction;

  it("groups with a space and uses a decimal comma", () => {
    expect(formatNumber(t, 1234)).toMatch(/^1[\u00a0\u202f]234$/);
    expect(formatNumber(t, 1234567)).toMatch(/^1[\u00a0\u202f]234[\u00a0\u202f]567$/);
    expect(formatNumber(t, 1234.56)).toMatch(/^1[\u00a0\u202f]234,56$/);
  });
});
