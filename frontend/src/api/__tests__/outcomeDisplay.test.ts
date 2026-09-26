import i18n from "i18next";
import {
  formatMetric,
  gameMetric,
  knownOutcome,
  outcomeDisplay,
  outcomeLabel,
} from "../outcomeDisplay";
import { formatPlayTime } from "../statsDisplay";
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
  const statsJson = (code: string): Record<string, string> =>
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    require(`../../i18n/locales/${code}/stats.json`);
  // Only this locale's strings and no fallback: a missing key shows up as the key, not English.
  const statsT = (code: string) => {
    const instance = i18n.createInstance();
    void instance.init({
      lng: code,
      fallbackLng: false,
      ns: ["stats"],
      defaultNS: "stats",
      resources: { [code]: { stats: statsJson(code) } },
      interpolation: { escapeValue: false },
      initAsync: false,
    });
    // Fixed to the locale, like useTranslation's t.
    return instance.getFixedT(code) as unknown as typeof t;
  };
  // A number in each of the locale's CLDR plural categories (fr/es/pt "many" is 1,000,000).
  const SAMPLES = [0, 1, 2, 3, 5, 11, 19, 21, 100, 101, 1_000_000, 1.5];
  const samplesByCategory = (code: string): [Intl.LDMLPluralRule, number][] => {
    const rules = new Intl.PluralRules(code);
    return rules.resolvedOptions().pluralCategories.map((category) => {
      const sample = SAMPLES.find((n) => rules.select(n) === category);
      if (sample === undefined) throw new Error(`No sample number for ${code} ${category}`);
      return [category, sample];
    });
  };

  it.each(LOCALES.map((l) => l.code))("%s has every outcome label in stats", (code) => {
    const tLocale = statsT(code);
    for (const outcome of GAME_OUTCOMES) {
      const label = outcomeLabel(tLocale, outcome);
      expect(label).not.toBe(outcomeDisplay(outcome).labelKey);
      expect(label).not.toMatch(/^(stats:)?outcome\./);
    }
  });

  it.each(LOCALES.map((l) => l.code))(
    "%s has its own metric label for every plural category",
    (code) => {
      const tLocale = statsT(code);
      const own = statsJson(code);
      const number = new Intl.NumberFormat(code);
      for (const labelKey of ["score", "moves", "guesses", "chips"]) {
        for (const [category, value] of samplesByCategory(code)) {
          const template = own[`metric.${labelKey}_${category}`];
          if (template === undefined)
            throw new Error(`${code} has no metric.${labelKey}_${category}`);
          expect(formatMetric(tLocale, labelKey, value)).toBe(
            template.replace("{{value}}", number.format(value))
          );
        }
      }
      expect(formatMetric(tLocale, "level", 19)).toBe(
        own["metric.level"]!.replace("{{value}}", number.format(19))
      );
    }
  );

  it.each(LOCALES.map((l) => l.code))("%s no longer has them in profile", (code) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const profile: Record<string, string> = require(`../../i18n/locales/${code}/profile.json`);
    expect(
      Object.keys(profile).filter((k) => /^(metric\.|recentGames\.outcome\.)/.test(k))
    ).toEqual([]);
  });
});

describe("numbers follow the app language, not the device (#2638)", () => {
  beforeAll(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    i18n.addResourceBundle("de", "stats", require("../../i18n/locales/de/stats.json"));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    i18n.addResourceBundle("de", "profile", require("../../i18n/locales/de/profile.json"));
  });

  beforeEach(async () => {
    // The device is on en-US, whatever machine runs the tests.
    jest.spyOn(Number.prototype, "toLocaleString").mockImplementation(function (this: number) {
      return new Intl.NumberFormat("en-US").format(this);
    });
    await i18n.changeLanguage("de");
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await i18n.changeLanguage("en");
  });

  afterAll(() => {
    i18n.removeResourceBundle("de", "stats");
    i18n.removeResourceBundle("de", "profile");
  });

  it("groups a metric the German way when the app is in German", () => {
    // Like useTranslation's t, fixed to the app language.
    const tDe = i18n.getFixedT(i18n.language) as unknown as typeof t;
    expect(formatMetric(tDe, "chips", 1450)).toBe("1.450 Chips");
    expect(formatMetric(tDe, "stars", 1450)).toBe("1.450");
    // A t with no language of its own uses i18next's.
    expect(formatMetric(t, "chips", 1450)).toBe("1.450 Chips");
  });

  it("groups play-time hours the German way", () => {
    const tDe = i18n.getFixedT(i18n.language) as unknown as typeof t;
    expect(formatPlayTime(tDe, (1234 * 60 + 5) * 60_000)).toBe("1.234 Std. 5 Min.");
  });

  it("still groups the English way in English", async () => {
    await i18n.changeLanguage("en");
    expect(formatMetric(t, "chips", 1450)).toBe("1,450 chips");
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
