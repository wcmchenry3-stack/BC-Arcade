import { dark, light } from "../../../theme/ThemeContext";
import { accentAsText } from "../tableAccentText";

describe("accentAsText (#3755)", () => {
  it.each([
    ["dark", dark],
    ["light", light],
  ])("maps the accent to accentText in %s", (_n, c) => {
    expect(accentAsText(c, c.accent)).toBe(c.accentText);
  });

  it("leaves the other tables' accents alone", () => {
    expect(accentAsText(light, light.secondary)).toBe(light.secondary);
    expect(accentAsText(light, light.tertiary)).toBe(light.tertiary);
  });

  it("light accent text differs from the raw accent", () => {
    expect(accentAsText(light, light.accent)).not.toBe(light.accent);
  });
});
