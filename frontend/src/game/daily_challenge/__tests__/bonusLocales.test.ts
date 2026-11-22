import fs from "fs";
import path from "path";

// #3995: the bonus row's strings exist in every shipped locale (docs/I18N.md §14), with
// the {{goal}} placeholder in both screen-reader labels.
const LOCALES_DIR = path.resolve(__dirname, "../../../i18n/locales");
const locales = fs
  .readdirSync(LOCALES_DIR, { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
  .map((entry) => entry.name);

describe("daily_challenge bonus strings", () => {
  it("covers every locale directory", () => {
    expect(locales).toEqual(expect.arrayContaining(["en", "es", "fr-CA", "de", "ja", "ar", "he"]));
  });

  it.each(locales)("%s has the Bonus label and both screen-reader labels", (locale) => {
    const file = path.join(LOCALES_DIR, locale, "daily_challenge.json");
    const copy = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
    expect(typeof copy["bonus.label"]).toBe("string");
    expect(copy["bonus.label"]!.trim()).not.toBe("");
    for (const key of ["bonus.doneA11y", "bonus.todoA11y"]) {
      expect(copy[key]).toContain("{{goal}}");
    }
  });
});
