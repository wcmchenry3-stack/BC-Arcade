import { availableLocales, resolveLocale } from "../resolveLocale";
import { __forceStoreBuildForTests } from "../../game/_shared/buildFlavour";

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

describe("store builds offer only the launch locales on native (#3150)", () => {
  // Through the real defaults, not an explicit flag: this is what i18n.ts and the
  // native LanguageSwitcher call in a store build.
  beforeEach(() => __forceStoreBuildForTests(true));
  afterEach(() => __forceStoreBuildForTests(false));

  it.each(["ios", "android"])("%s offers exactly en, fr-CA and es", (os) => {
    expect(availableLocales(os).map((l) => l.code)).toEqual(["en", "fr-CA", "es"]);
  });

  it.each(["hi-IN", "de-DE", "ja-JP", "pt-BR", "ar-SA"])("a %s device falls back to en", (tag) => {
    expect(resolveLocale([dev(tag)], "ios")).toBe("en");
  });

  it("a hidden first preference falls through to a launch locale", () => {
    expect(resolveLocale([dev("de-DE"), dev("es-MX")], "android")).toBe("es");
    expect(resolveLocale([dev("hi-IN"), dev("fr-FR")], "ios")).toBe("fr-CA");
  });

  it("es-US and fr-CA devices keep their language", () => {
    expect(resolveLocale([dev("es-US")], "ios")).toBe("es");
    expect(resolveLocale([dev("fr-CA")], "android")).toBe("fr-CA");
  });

  it("web is not a store platform and keeps every locale", () => {
    expect(availableLocales("web").map((l) => l.code)).toEqual(
      expect.arrayContaining(["hi", "de", "ar", "he"])
    );
    expect(resolveLocale([dev("ar-SA")], "web")).toBe("ar");
  });
});

describe("dev and test builds keep every locale", () => {
  it("offers unlaunched locales on native", () => {
    expect(availableLocales("ios").map((l) => l.code)).toEqual(
      expect.arrayContaining(["hi", "de", "ja"])
    );
  });
});
