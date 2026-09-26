import { LOCALES, NATIVE_LOCALES, RTL_LOCALES } from "../locales";

describe("LOCALES", () => {
  it("exports at least 2 locales", () => {
    expect(LOCALES.length).toBeGreaterThan(1);
  });

  it("includes English as the first locale", () => {
    expect(LOCALES[0]?.code).toBe("en");
  });

  it("all locales have required fields", () => {
    for (const locale of LOCALES) {
      expect(locale).toHaveProperty("code");
      expect(locale).toHaveProperty("label");
      expect(locale).toHaveProperty("nativeLabel");
      expect(locale).toHaveProperty("flag");
      expect(locale.dir === "ltr" || locale.dir === "rtl").toBe(true);
    }
  });

  it("has no duplicate codes", () => {
    const codes = LOCALES.map((l) => l.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("RTL_LOCALES contains ar and he", () => {
    expect(RTL_LOCALES.has("ar")).toBe(true);
    expect(RTL_LOCALES.has("he")).toBe(true);
  });

  it("RTL_LOCALES entries match locales with dir=rtl", () => {
    const rtlFromArray = LOCALES.filter((l) => l.dir === "rtl").map((l) => l.code);
    for (const code of rtlFromArray) {
      expect(RTL_LOCALES.has(code)).toBe(true);
    }
    expect(RTL_LOCALES.size).toBe(rtlFromArray.length);
  });

  it("NATIVE_LOCALES excludes every RTL locale but keeps all LTR ones", () => {
    for (const locale of NATIVE_LOCALES) {
      expect(RTL_LOCALES.has(locale.code)).toBe(false);
    }
    expect(NATIVE_LOCALES.length).toBe(LOCALES.length - RTL_LOCALES.size);
    expect(NATIVE_LOCALES[0]?.code).toBe("en");
  });
});
