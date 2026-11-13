import { dark, light } from "../../../theme/ThemeContext";
import { accentAsText, labelOnFill } from "../tableAccentText";

describe("accentAsText (#3755)", () => {
  it.each([
    ["dark", dark],
    ["light", light],
  ])("maps the accent to accentText in %s", (_n, c) => {
    expect(accentAsText(c, c.accent)).toBe(c.accentText);
  });

  it.each([
    ["dark", dark],
    ["light", light],
  ])("maps the secondary and tertiary accents to their text tokens in %s (#3819)", (_n, c) => {
    expect(accentAsText(c, c.secondary)).toBe(c.secondaryText);
    expect(accentAsText(c, c.tertiary)).toBe(c.tertiaryText);
  });

  it("light secondary and tertiary text differ from the raw accents", () => {
    expect(accentAsText(light, light.secondary)).not.toBe(light.secondary);
    expect(accentAsText(light, light.tertiary)).not.toBe(light.tertiary);
  });

  it("dark is unchanged: every table accent is returned as it was", () => {
    for (const a of [dark.accent, dark.secondary, dark.tertiary]) {
      expect(accentAsText(dark, a)).toBe(a);
    }
  });

  it("passes any other colour through", () => {
    expect(accentAsText(light, "#123456")).toBe("#123456");
  });

  it("light accent text differs from the raw accent", () => {
    expect(accentAsText(light, light.accent)).not.toBe(light.accent);
  });
});

describe("labelOnFill (#3819)", () => {
  it("is white on the secondary fill in light", () => {
    expect(labelOnFill(light, "light", light.secondary)).toBe("#ffffff");
  });

  it("is today's textOnAccent on every fill in dark", () => {
    for (const f of [dark.accent, dark.secondary, dark.tertiary]) {
      expect(labelOnFill(dark, "dark", f)).toBe(dark.textOnAccent);
    }
  });

  it("is textOnAccent on the accent and tertiary fills in light", () => {
    expect(labelOnFill(light, "light", light.accent)).toBe(light.textOnAccent);
    expect(labelOnFill(light, "light", light.tertiary)).toBe(light.textOnAccent);
  });
});
