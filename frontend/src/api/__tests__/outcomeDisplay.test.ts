import i18n from "i18next";
import {
  formatMetric,
  gameMetric,
  knownOutcome,
  outcomeDisplay,
  outcomeLabel,
} from "../outcomeDisplay";
import { GAME_OUTCOMES } from "../vocab";
import { LOCALES } from "../../i18n/locales";

const t = i18n.t.bind(i18n);

describe("outcomeDisplay (#2637)", () => {
  it.each(GAME_OUTCOMES)("gives %s a glyph and an English label", (outcome) => {
    const display = outcomeDisplay(outcome);
    expect(display.icon).toBeTruthy();
    const label = t(`stats:${display.labelKey}`);
    expect(label).not.toBe(display.labelKey);
    expect(label).not.toBe(outcome);
  });

  it("gives every outcome its own glyph and label", () => {
    const displays = GAME_OUTCOMES.map(outcomeDisplay);
    expect(new Set(displays.map((d) => d.icon)).size).toBe(GAME_OUTCOMES.length);
    expect(new Set(displays.map((d) => d.labelKey)).size).toBe(GAME_OUTCOMES.length);
  });

  it("labels win, loss and push as a player reads them", () => {
    expect(outcomeLabel(t, "win")).toBe("Win");
    expect(outcomeLabel(t, "loss")).toBe("Loss");
    expect(outcomeLabel(t, "push")).toBe("Tie");
  });

  it("shows a dash, and no glyph, for a missing or unknown outcome", () => {
    expect(outcomeLabel(t, null)).toBe("—");
    expect(outcomeLabel(t, "forfeit")).toBe("—");
    expect(knownOutcome(null)).toBeNull();
    expect(knownOutcome("forfeit")).toBeNull();
  });
});

describe("formatMetric (#2637)", () => {
  it.each([
    ["score", 412, "412 pts"],
    ["score", 1, "1 pt"],
    ["score", 15240, "15,240 pts"],
    ["moves", 87, "87 moves"],
    ["moves", 1, "1 move"],
    ["level", 19, "Level 19"],
    ["guesses", 3, "3 guesses"],
    ["chips", 1450, "1,450 chips"],
  ])("formats %s %d as %s", (labelKey, value, expected) => {
    expect(formatMetric(t, labelKey, value)).toBe(expected);
  });

  it("shows the bare number for a label this build doesn't know", () => {
    expect(formatMetric(t, "stars", 1200)).toBe("1,200");
    expect(formatMetric(t, null, 7)).toBe("7");
  });

  it("shows a dash when there is no value", () => {
    expect(formatMetric(t, "moves", null)).toBe("—");
    expect(formatMetric(t, "moves", undefined)).toBe("—");
  });
});

describe("outcome and metric labels in every locale (#2638)", () => {
  // The labels moved from "profile" to "stats": Profile, GameDetail and Stats all show them.
  const statsT = (code: string) => {
    const instance = i18n.createInstance();
    void instance.init({
      lng: code,
      ns: ["stats"],
      defaultNS: "stats",
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      resources: { [code]: { stats: require(`../../i18n/locales/${code}/stats.json`) } },
      interpolation: { escapeValue: false },
      initAsync: false,
    });
    return instance.t.bind(instance) as unknown as typeof t;
  };

  it.each(LOCALES.map((l) => l.code))("%s has every outcome label in stats", (code) => {
    const tLocale = statsT(code);
    for (const outcome of GAME_OUTCOMES) {
      const label = outcomeLabel(tLocale, outcome);
      expect(label).not.toBe(outcomeDisplay(outcome).labelKey);
      expect(label).not.toMatch(/^(stats:)?outcome\./);
    }
  });

  it.each(LOCALES.map((l) => l.code))("%s has every metric label in stats", (code) => {
    const tLocale = statsT(code);
    for (const labelKey of ["score", "moves", "level", "guesses", "chips"]) {
      for (const value of [1, 2, 5, 19]) {
        const text = formatMetric(tLocale, labelKey, value);
        expect(text).not.toMatch(/metric\./);
        expect(text).not.toBe(value.toLocaleString());
      }
    }
  });

  it.each(LOCALES.map((l) => l.code))("%s no longer has them in profile", (code) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profile: Record<string, string> = require(`../../i18n/locales/${code}/profile.json`);
    expect(
      Object.keys(profile).filter((k) => /^(metric\.|recentGames\.outcome\.)/.test(k))
    ).toEqual([]);
  });
});

describe("gameMetric", () => {
  it("reads final_score for a final_score board", () => {
    expect(gameMetric({ game_type: "freecell", final_score: 87, metadata: {} })).toEqual({
      value: 87,
      labelKey: "moves",
    });
  });

  it("reads the board's metadata key for other boards", () => {
    expect(
      gameMetric({ game_type: "sort", final_score: 0, metadata: { level_reached: 19 } })
    ).toEqual({ value: 19, labelKey: "level" });
    expect(
      gameMetric({ game_type: "daily_word", final_score: null, metadata: { guesses_used: 4 } })
    ).toEqual({ value: 4, labelKey: "guesses" });
  });

  it("gives null when the metadata key is missing or not a number", () => {
    expect(gameMetric({ game_type: "sort", final_score: 5, metadata: {} }).value).toBeNull();
    expect(
      gameMetric({ game_type: "sort", final_score: 5, metadata: { level_reached: "19" } }).value
    ).toBeNull();
  });
});
