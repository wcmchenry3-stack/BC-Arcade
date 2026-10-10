import { availableLocales, resolveLocale } from "../resolveLocale";

const dev = (languageTag: string) => ({
  languageTag,
  languageCode: languageTag.split("-")[0] ?? null,
});

describe("resolveLocale", () => {
  it("returns an exact supported tag", () => {
    expect(resolveLocale([dev("fr-CA")], "ios")).toBe("fr-CA");
  });

  it("falls back to the base language code", () => {
    expect(resolveLocale([dev("fr-FR")], "android")).toBe("fr-CA");
  });

  it("falls back to en when nothing matches", () => {
    expect(resolveLocale([dev("sv-SE")], "ios")).toBe("en");
  });

  it.each(["ios", "android"])("never selects ar/he on %s", (os) => {
    expect(resolveLocale([dev("ar-SA")], os)).toBe("en");
    expect(resolveLocale([dev("he-IL")], os)).toBe("en");
  });

  it("skips an unsupported RTL locale and uses the next device preference", () => {
    expect(resolveLocale([dev("ar-SA"), dev("de-DE")], "android")).toBe("de");
  });

  it("keeps ar/he on web", () => {
    expect(resolveLocale([dev("ar-SA")], "web")).toBe("ar");
    expect(resolveLocale([dev("he")], "web")).toBe("he");
  });
});

describe("availableLocales", () => {
  it("excludes RTL locales on native only", () => {
    const native = availableLocales("ios").map((l) => l.code);
    const web = availableLocales("web").map((l) => l.code);
    expect(native).not.toContain("ar");
    expect(native).not.toContain("he");
    expect(web).toEqual(expect.arrayContaining(["ar", "he"]));
  });
});

describe("store builds offer only the launch locales (#3150)", () => {
  it.each(["ios", "android", "web"])("%s offers exactly en, fr-CA and es", (os) => {
    expect(availableLocales(os, true).map((l) => l.code)).toEqual(["en", "fr-CA", "es"]);
  });

  it.each(["hi-IN", "de-DE", "ja-JP", "pt-BR", "ar-SA"])("a %s device falls back to en", (tag) => {
    expect(resolveLocale([dev(tag)], "ios", true)).toBe("en");
  });

  it("a hidden first preference falls through to a launch locale", () => {
    expect(resolveLocale([dev("de-DE"), dev("es-MX")], "android", true)).toBe("es");
    expect(resolveLocale([dev("hi-IN"), dev("fr-FR")], "ios", true)).toBe("fr-CA");
  });

  it("es-US and fr-CA devices keep their language", () => {
    expect(resolveLocale([dev("es-US")], "ios", true)).toBe("es");
    expect(resolveLocale([dev("fr-CA")], "android", true)).toBe("fr-CA");
  });

  it("dev and test builds still offer every locale", () => {
    expect(availableLocales("ios", false).map((l) => l.code)).toContain("hi");
  });
});
