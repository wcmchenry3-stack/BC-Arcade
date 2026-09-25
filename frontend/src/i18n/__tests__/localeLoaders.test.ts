import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import i18next from "i18next";
import resourcesToBackend from "i18next-resources-to-backend";
import { LOCALES } from "../locales";
import { NAMESPACES, loadLocaleNamespace, localeLoaders, type Namespace } from "../localeLoaders";

// #2193: a locale file that exists but is not in the loader table is never
// loaded, and i18next quietly shows English instead.

const LOCALES_DIR = join(__dirname, "..", "locales");
const PLACEHOLDER = "__NEEDS_TRANSLATION__";

const localeDirs = readdirSync(LOCALES_DIR).filter(
  (d) => d !== "_meta" && statSync(join(LOCALES_DIR, d)).isDirectory()
);
const filesOf = (locale: string) =>
  readdirSync(join(LOCALES_DIR, locale))
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -".json".length));
const readJson = (locale: string, ns: string) =>
  JSON.parse(readFileSync(join(LOCALES_DIR, locale, `${ns}.json`), "utf8")) as Record<
    string,
    string
  >;

describe("localeLoaders (#2193)", () => {
  it("has one namespace per English file", () => {
    expect([...NAMESPACES].sort()).toEqual(filesOf("en").sort());
  });

  it("has a loader table for every supported locale, and only those", () => {
    const codes = LOCALES.map((l) => l.code).sort();
    expect(Object.keys(localeLoaders).sort()).toEqual(codes);
    expect([...localeDirs].sort()).toEqual(codes);
  });

  it.each(localeDirs)("%s: loads every translation file it has", (locale) => {
    const wired = Object.keys(localeLoaders[locale] ?? {}).sort();
    expect(wired).toEqual(filesOf(locale).sort());
  });

  // Jest cannot run the dynamic imports, so check the path each one names.
  it.each(localeDirs)("%s: each loader imports its own locale's file", (locale) => {
    const loaders = localeLoaders[locale] ?? {};
    for (const ns of filesOf(locale)) {
      const source = String(loaders[ns as Namespace]);
      expect({ ns, source }).toEqual({
        ns,
        source: expect.stringContaining(`./locales/${locale}/${ns}.json`),
      });
    }
  });

  it.each(localeDirs)("%s: no loaded file still holds a placeholder", (locale) => {
    for (const ns of filesOf(locale)) {
      const stubs = Object.entries(readJson(locale, ns))
        .filter(([, v]) => v === PLACEHOLDER)
        .map(([k]) => `${ns}:${k}`);
      expect(stubs).toEqual([]);
    }
  });

  it("loads a locale's own file, and nothing for one it lacks", async () => {
    const own = jest
      .spyOn(localeLoaders.de!, "hearts")
      .mockResolvedValue({ default: { own: "de" } });
    const english = jest
      .spyOn(localeLoaders.en!, "common")
      .mockResolvedValue({ default: { own: "en" } });
    try {
      expect((await loadLocaleNamespace("de", "hearts")).default).toEqual({ own: "de" });
      // A locale or namespace with no file loads nothing; English comes from
      // fallbackLng, not stored as that locale's own.
      expect((await loadLocaleNamespace("xx", "common")).default).toEqual({});
      expect((await loadLocaleNamespace("de", "not-a-namespace")).default).toEqual({});
      expect(own).toHaveBeenCalledTimes(1);
      expect(english).not.toHaveBeenCalled();
    } finally {
      own.mockRestore();
      english.mockRestore();
    }
  });

  it("shows English through fallbackLng for a namespace the locale lacks", async () => {
    // The same shape as i18n.ts: German has no `extra` file, English does.
    const load = (lng: string, ns: string) =>
      Promise.resolve({
        default: lng === "en" && ns === "extra" ? { hello: "Hello" } : { own: `${lng}:${ns}` },
      });
    const instance = i18next.createInstance();
    await instance.use(resourcesToBackend(load)).init({
      lng: "de",
      fallbackLng: "en",
      ns: ["extra"],
      defaultNS: "extra",
    });
    expect(instance.t("hello")).toBe("Hello");
    expect(instance.getResource("de", "extra", "hello")).toBeUndefined();
  });
});
