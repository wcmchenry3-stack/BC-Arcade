/**
 * Hebrew strings are stored in logical order (#3828). A leading "!" "?" "." ":" is a visual-order
 * habit ("!ניצחת"): the text engines already draw a trailing mark at the visual left of RTL text, and
 * screen readers read a leading one first (or skip it).
 */
import fs from "fs";
import path from "path";

const DIR = path.join(__dirname, "..", "locales", "he");

const entries: Array<[string, string]> = [];
for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(DIR, file), "utf8")) as Record<string, unknown>;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === "string") entries.push([`${file.replace(/\.json$/, "")}.${key}`, value]);
  }
}

describe("he locale logical order (#3828)", () => {
  it("scans a non-trivial number of strings", () => {
    expect(entries.length).toBeGreaterThan(500);
  });

  it("has no value that starts with sentence punctuation", () => {
    const offenders = entries
      .filter(([, v]) => /^\s*[!?.:]/.test(v))
      .map(([k, v]) => `${k}: ${JSON.stringify(v)}`);
    expect(offenders).toEqual([]);
  });
});
